import csv, hashlib, hmac, io, os, random, re, secrets, uuid, jwt, bcrypt
from collections import Counter
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPBearer
from pydantic import BaseModel, EmailStr
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import or_, func
from models import *
import ocr

SECRET = os.getenv("SECRET_KEY", "change-me-in-env")
ATS_MIN = 70  # minimum match percent to be shortlisted
TEST_SIZE, TEST_MINUTES, LINK_DAYS = 20, 30, 3
PASS_PERCENT = int(os.getenv("PASS_PERCENT", "60"))  # passing marks as a percent of the test
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
STATUSES = ["Applied", "Under Review", "Shortlisted", "Interview", "Selected", "Rejected"]
app = FastAPI(title="SkillSphere API")
cors_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()]
if FRONTEND_URL and FRONTEND_URL not in cors_origins:
    cors_origins.append(FRONTEND_URL)
if "http://localhost:5173" not in cors_origins:
    cors_origins.append("http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
bearer = HTTPBearer(auto_error=False)
os.makedirs("uploads", exist_ok=True)

@app.get("/health")
def health():
    return {"status": "ok", "database_configured": Session is not None}

@app.on_event("startup")
def start():
    if engine is None or Session is None:
        print("DATABASE_URL is not configured. API health check is available; database features are disabled.")
        return

    Base.metadata.create_all(engine)
    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")
    admin_name = os.getenv("ADMIN_NAME", "Admin")
    if admin_email and admin_password:
        s = Session()
        try:
            if not s.query(User).filter_by(role="admin").first():
                s.add(User(name=admin_name, email=admin_email, role="admin", password_hash=hp(admin_password)))
                s.commit()
        finally:
            s.close()

    delete_expired_recordings()
    if not recording_scheduler.running:
        recording_scheduler.add_job(
            delete_expired_recordings,
            "interval",
            minutes=10,
            id="cloudinary_recording_expiry",
            replace_existing=True,
        )
        recording_scheduler.start()

def hp(p): return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def db():
    if Session is None:
        raise HTTPException(503, "Database is not configured. Set DATABASE_URL on the backend service.")
    s = Session()
    try:
        yield s
    finally:
        s.close()

def me(c=Depends(bearer), s=Depends(db)):
    if not c: raise HTTPException(401, "Please log in")
    try: uid = int(jwt.decode(c.credentials, SECRET, algorithms=["HS256"])["sub"])
    except jwt.ExpiredSignatureError: raise HTTPException(401, "Session expired, please log in again")
    except jwt.PyJWTError: raise HTTPException(401, "Invalid token")
    u = s.get(User, uid)
    if not u or not u.active: raise HTTPException(401, "Account unavailable")
    return u

def role(*r):
    def f(u=Depends(me)):
        if u.role not in r: raise HTTPException(403, "You do not have access to this")
        return u
    return f

def cand(u, s): return s.query(Candidate).filter_by(user_id=u.id).first()
def rec(u, s): return s.query(Recruiter).filter_by(user_id=u.id).first()
def skill_names(model, key, val, s):
    return [x.name for x in s.query(Skill).join(model, model.skill_id == Skill.id).filter(key == val)]
def set_skills(model, key, val, names, s):
    s.query(model).filter(key == val).delete()
    for n in {x.strip() for x in names if x.strip()}:
        sk = s.query(Skill).filter(Skill.name == n).first() or Skill(name=n)
        s.add(sk); s.flush()
        s.add(model(**{key.key: val, "skill_id": sk.id}))

# ---------- auth ----------
class Reg(BaseModel):
    name: str; email: EmailStr; password: str; role: str; company: Optional[str] = None
class Login(BaseModel):
    email: EmailStr; password: str; role: Optional[str] = None

# ---------- sign-up with email verification code (OTP) ----------
OTP_MINUTES, OTP_TRIES, OTP_RESEND = 10, 5, 60  # code lifetime, wrong tries allowed, seconds before a new code

class Ver(BaseModel):
    email: EmailStr; code: str
class Resend(BaseModel):
    email: EmailStr

def otp_hash(email, code):
    return hmac.new(SECRET.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()

def send_mail_strict(to, subject, body):
    """Like send_mail, but raises when the email cannot be sent. Returns 'email' or 'terminal'."""
    host = os.getenv("SMTP_HOST")
    if not host:
        print(f"\n[EMAIL not configured, printed instead]\nTo: {to}\nSubject: {subject}\n\n{body}\n"); return "terminal"
    from email.message import EmailMessage; import smtplib
    msg = EmailMessage(); msg["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER", ""); msg["To"] = to; msg["Subject"] = subject; msg.set_content(body)
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=20) as srv:
        srv.starttls(); srv.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASS", "")); srv.send_message(msg)
    return "email"

def issue_code(p, s):
    """Makes a fresh 6-digit code for a pending sign-up, emails it, and saves only its hash."""
    code = f"{secrets.randbelow(10**6):06d}"
    try:
        how = send_mail_strict(p.email, "Your Matchly verification code",
            f"Hi {p.name},\n\nYour verification code is: {code}\n\nIt is valid for {OTP_MINUTES} minutes. If you did not create a Matchly account, you can ignore this email.\n\nMatchly")
    except Exception as e:
        print("[EMAIL failed]", e)
        raise HTTPException(502, "We could not send the code to that address. Check the email and try again.")
    now = datetime.utcnow()
    p.code_hash, p.attempts, p.last_sent, p.expires = otp_hash(p.email, code), 0, now, now + timedelta(minutes=OTP_MINUTES)
    s.commit()
    return how

@app.post("/auth/register", status_code=202)
def register(d: Reg, s=Depends(db)):
    email = d.email.lower()
    if d.role not in ("candidate", "recruiter"): raise HTTPException(422, "Role must be candidate or recruiter")
    if len(d.password) < 8: raise HTTPException(422, "Password must be at least 8 characters")
    if not d.name.strip(): raise HTTPException(422, "Name is required")
    if s.query(User).filter_by(email=email).first(): raise HTTPException(409, "Email is already registered")
    now = datetime.utcnow()
    s.query(PendingSignup).filter(PendingSignup.expires < now - timedelta(hours=1)).delete()  # tidy old, abandoned sign-ups
    p = s.query(PendingSignup).filter_by(email=email).first()
    if p and (now - p.last_sent).total_seconds() < OTP_RESEND:
        raise HTTPException(429, f"Please wait {OTP_RESEND - int((now - p.last_sent).total_seconds())} seconds before asking for a new code")
    if not p:
        p = PendingSignup(email=email, code_hash="", expires=now, last_sent=now); s.add(p)
    p.name, p.password_hash, p.role, p.company = d.name.strip(), hp(d.password), d.role, d.company
    how = issue_code(p, s)
    return {"message": f"We sent a 6-digit code to {email}. It is valid for {OTP_MINUTES} minutes.", "email": email, "minutes": OTP_MINUTES, "delivery": how}

@app.post("/auth/verify")
def verify(d: Ver, s=Depends(db)):
    email = d.email.lower(); p = s.query(PendingSignup).filter_by(email=email).first()
    if not p: raise HTTPException(404, "No sign-up is waiting for this email. Please start again.")
    if datetime.utcnow() > p.expires:
        s.delete(p); s.commit(); raise HTTPException(410, "This code has expired. Please sign up again to get a new one.")
    if not hmac.compare_digest(p.code_hash, otp_hash(email, d.code.strip())):
        p.attempts += 1; left = OTP_TRIES - p.attempts
        if left <= 0:
            s.delete(p); s.commit(); raise HTTPException(429, "Too many wrong codes. Please sign up again.")
        s.commit(); raise HTTPException(400, f"Wrong code. {left} attempt{'s' if left != 1 else ''} left.")
    if s.query(User).filter_by(email=email).first():
        s.delete(p); s.commit(); raise HTTPException(409, "Email is already registered")
    u = User(name=p.name, email=email, password_hash=p.password_hash, role=p.role); s.add(u); s.flush()
    if p.role == "candidate": s.add(Candidate(user_id=u.id))
    else:
        co = Company(name=p.company or f"{p.name}'s Company"); s.add(co); s.flush()
        s.add(Recruiter(user_id=u.id, company_id=co.id))
    s.delete(p); s.commit()
    tok = jwt.encode({"sub": str(u.id), "exp": datetime.utcnow() + timedelta(hours=12)}, SECRET, algorithm="HS256")
    return {"token": tok, "role": u.role, "name": u.name}

@app.post("/auth/resend")
def resend_code(d: Resend, s=Depends(db)):
    p = s.query(PendingSignup).filter_by(email=d.email.lower()).first()
    if not p: raise HTTPException(404, "No sign-up is waiting for this email. Please start again.")
    wait = OTP_RESEND - int((datetime.utcnow() - p.last_sent).total_seconds())
    if wait > 0: raise HTTPException(429, f"Please wait {wait} seconds before asking for a new code")
    how = issue_code(p, s)
    return {"message": f"A new code was sent to {p.email}.", "delivery": how, "minutes": OTP_MINUTES}

@app.post("/auth/login")
def login(d: Login, s=Depends(db)):
    u = s.query(User).filter_by(email=d.email.lower()).first()
    if not u or not bcrypt.checkpw(d.password.encode(), u.password_hash.encode()): raise HTTPException(401, "Wrong email or password")
    if not u.active: raise HTTPException(403, "This account is disabled")
    names = {"candidate": "job seeker", "recruiter": "recruiter", "admin": "admin"}
    want = {"seeker": "candidate", "recruiter": "recruiter", "admin": "admin"}.get(d.role or "")
    if want and u.role != want: raise HTTPException(403, f"This is a {names[u.role]} account. Use the {names[u.role]} login.")
    tok = jwt.encode({"sub": str(u.id), "exp": datetime.utcnow() + timedelta(hours=12)}, SECRET, algorithm="HS256")
    return {"token": tok, "role": u.role, "name": u.name}

# ---------- resume ----------
class Prof(BaseModel):
    phone: Optional[str] = ""; education: Optional[str] = ""; experience: Optional[str] = ""
    summary: Optional[str] = ""; skills: List[str] = []

def process(rid):  # runs in background so uploads return immediately
    s = Session(); r = s.get(Resume, rid)
    try:
        text = ocr.extract(r.path, r.file_type)
        if len(text.strip()) < 20: raise ValueError("No readable text found in this file")
        p = ocr.parse(text); c = s.get(Candidate, r.candidate_id)
        r.text, r.parsed = text, p
        c.phone = p["phone"] or c.phone; c.education = p["education"] or c.education
        c.experience = p["experience"] or c.experience
        if p["skills"]: set_skills(CandidateSkill, CandidateSkill.candidate_id, c.id, p["skills"], s)
        r.status = "done"
    except Exception as e:
        s.rollback(); r = s.get(Resume, rid); r.status = "failed"
        r.error = f"Could not read this resume: {str(e)[:180]}"
    s.commit(); s.close()

@app.post("/resume/upload", status_code=202)
async def upload(bg: BackgroundTasks, f: UploadFile = File(...), u=Depends(role("candidate")), s=Depends(db)):
    data = await f.read()
    if not data: raise HTTPException(422, "The file is empty")
    if len(data) > 10 * 1024 * 1024: raise HTTPException(413, "File is larger than 10 MB")
    kind = ocr.sniff(data)  # checks real content, not the extension
    if not kind: raise HTTPException(415, "Only PDF, JPG and PNG files are allowed")
    c = cand(u, s); path = f"uploads/{uuid.uuid4().hex}.{kind}"
    open(path, "wb").write(data)
    r = Resume(candidate_id=c.id, filename=os.path.basename(f.filename or "resume")[:200], path=path, file_type=kind, status="processing")
    s.add(r); s.commit(); bg.add_task(process, r.id)
    return {"id": r.id, "status": "processing"}

@app.get("/resume/profile")
def profile(u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); r = s.query(Resume).filter_by(candidate_id=c.id).order_by(Resume.id.desc()).first()
    return {"name": u.name, "email": u.email, "phone": c.phone or "", "education": c.education or "",
            "experience": c.experience or "", "summary": c.summary or "",
            "skills": skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s),
            "resume": r and {"id": r.id, "filename": r.filename, "status": r.status, "error": r.error, "parsed": r.parsed}}

@app.put("/resume/profile")
def save_profile(d: Prof, u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); c.phone, c.education, c.experience, c.summary = d.phone, d.education, d.experience, d.summary
    set_skills(CandidateSkill, CandidateSkill.candidate_id, c.id, d.skills, s); s.commit()
    return {"message": "Profile saved"}

@app.get("/resume/{rid}/file")
def resume_file(rid: int, u=Depends(me), s=Depends(db)):
    r = s.get(Resume, rid)
    if not r: raise HTTPException(404, "Resume not found")
    ok = u.role == "admin"
    if u.role == "candidate": ok = r.candidate_id == cand(u, s).id
    if u.role == "recruiter":
        rc = rec(u, s)
        ok = s.query(Application).join(Job, Job.id == Application.job_id).filter(
            Application.resume_id == rid, Job.recruiter_id == rc.id).first() is not None
    if not ok: raise HTTPException(403, "You do not have access to this resume")
    return FileResponse(r.path, filename=r.filename)

class An(BaseModel): job_id: int

@app.post("/resume/analyze")
def analyze(d: An, u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); j = s.get(Job, d.job_id)
    r = s.query(Resume).filter_by(candidate_id=c.id, status="done").order_by(Resume.id.desc()).first()
    if not j: raise HTTPException(404, "Job not found")
    if not r: raise HTTPException(422, "Upload a resume and wait for processing first")
    have = {x.lower(): x for x in skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s)}
    req = skill_names(JobSkill, JobSkill.job_id, j.id, s)
    if not req: raise HTTPException(422, "This job lists no required skills to compare")
    matched = [x for x in req if x.lower() in have]; missing = [x for x in req if x.lower() not in have]
    score = round(100 * len(matched) / len(req))  # score = matched required skills / all required skills
    rc = ("Strong match. Apply with confidence." if not missing else
          f"Learn or add these to improve your match: {', '.join(missing)}.")
    s.add(ResumeAnalysis(resume_id=r.id, job_id=j.id, score=score, matched=matched, missing=missing)); s.commit()
    return {"score": score, "matched": matched, "missing": missing, "recommendation": rc}

# ---------- jobs ----------
class JobIn(BaseModel):
    title: str; description: str; location: str; min_exp: int = 0; max_exp: int = 0
    job_type: str = "Full-time"; salary: Optional[str] = None; skills: List[str] = []; status: str = "published"

def jout(j, s, full=False):
    co = s.get(Company, s.get(Recruiter, j.recruiter_id).company_id)
    d = dict(id=j.id, title=j.title, company=co.name, location=j.location, min_exp=j.min_exp, max_exp=j.max_exp,
             job_type=j.job_type, salary=j.salary, status=j.status, created=j.created and j.created.isoformat(), skills=skill_names(JobSkill, JobSkill.job_id, j.id, s))
    if full: d.update(description=j.description, company_about=co.description)
    return d

@app.get("/jobs")
def jobs(q: str = "", location: str = "", job_type: str = "", exp: Optional[int] = None, skill: str = "",
         sort: str = "new", page: int = Query(1, ge=1), size: int = Query(6, le=50), s=Depends(db)):
    qs = s.query(Job).filter(Job.status == "published")
    if q: qs = qs.filter(or_(Job.title.ilike(f"%{q}%"), Job.description.ilike(f"%{q}%")))
    if location: qs = qs.filter(Job.location.ilike(f"%{location}%"))
    if job_type: qs = qs.filter(Job.job_type == job_type)
    if exp is not None: qs = qs.filter(Job.min_exp <= exp, Job.max_exp >= exp)
    if skill:
        ids = s.query(JobSkill.job_id).join(Skill, Skill.id == JobSkill.skill_id).filter(Skill.name.ilike(f"%{skill}%"))
        qs = qs.filter(Job.id.in_(ids))
    qs = qs.order_by(Job.min_exp if sort == "exp" else Job.created.desc())
    total = qs.count()
    return {"items": [jout(j, s) for j in qs.offset((page - 1) * size).limit(size)], "total": total, "pages": max(1, -(-total // size))}

class QuestionUpdate(BaseModel):
    text: str
    a: str
    b: str
    c: str
    d: str
    answer: str


@app.post("/jobs", status_code=201)
def create_job(d: JobIn, u=Depends(role("recruiter")), s=Depends(db)):
    if d.status not in ("draft", "published"):
        raise HTTPException(422, "Status must be draft or published")
    if d.status == "published":
        raise HTTPException(422, "Create the job as a draft, upload at least 50 valid job-specific questions, then publish it.")
    if d.max_exp < d.min_exp:
        raise HTTPException(422, "Max experience must be at least min experience")
    j = Job(recruiter_id=rec(u, s).id, **d.dict(exclude={"skills", "status"}), status="draft")
    s.add(j); s.flush()
    set_skills(JobSkill, JobSkill.job_id, j.id, d.skills, s)
    s.commit()
    return jout(j, s)

@app.get("/jobs/{jid}")
def job(jid: int, s=Depends(db)):
    j = s.get(Job, jid)
    if not j or j.status != "published": raise HTTPException(404, "Job not found")
    return jout(j, s, True)

class St(BaseModel): status: str

@app.put("/jobs/{jid}/status")
def job_status(jid: int, d: St, u=Depends(role("recruiter", "admin")), s=Depends(db)):
    j = s.get(Job, jid)
    if not j: raise HTTPException(404, "Job not found")
    allowed = ["draft", "published", "closed"] if u.role == "recruiter" else ["published", "disabled", "closed"]
    if u.role == "recruiter" and j.recruiter_id != rec(u, s).id: raise HTTPException(403, "This is not your job posting")
    if d.status not in allowed: raise HTTPException(422, f"Status must be one of {allowed}")
    if u.role == "recruiter" and j.status == "disabled": raise HTTPException(403, "An admin disabled this job")
    if d.status == "published":
        count = s.query(Question).filter(Question.job_id == j.id).count()
        if count < 50:
            raise HTTPException(422, f"This job has {count}/50 valid questions. Upload at least {50 - count} more before publishing.")
    j.status = d.status; s.commit(); return {"message": "Updated"}

@app.get("/recruiter/jobs")
def my_jobs(u=Depends(role("recruiter")), s=Depends(db)):
    return [jout(j, s) for j in s.query(Job).filter_by(recruiter_id=rec(u, s).id).order_by(Job.id.desc())]

class Co(BaseModel):
    name: str; description: Optional[str] = ""; contact: Optional[str] = ""

@app.put("/recruiter/company")
def company(d: Co, u=Depends(role("recruiter")), s=Depends(db)):
    c = s.get(Company, rec(u, s).company_id); c.name, c.description, c.contact = d.name, d.description, d.contact
    s.commit(); return {"message": "Company saved"}

@app.get("/recruiter/company")
def get_company(u=Depends(role("recruiter")), s=Depends(db)):
    c = s.get(Company, rec(u, s).company_id); return {"name": c.name, "description": c.description or "", "contact": c.contact or ""}

# ---------- applications ----------
@app.post("/jobs/{jid}/apply", status_code=201)
def apply(jid: int, bg: BackgroundTasks, u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); j = s.get(Job, jid)
    if not j or j.status != "published": raise HTTPException(404, "This job is not open")
    r = s.query(Resume).filter_by(candidate_id=c.id, status="done").order_by(Resume.id.desc()).first()
    if not r: raise HTTPException(422, "Upload a resume and wait for processing before applying")
    a = s.query(Application).filter_by(job_id=jid, candidate_id=c.id).first()
    if a and a.status not in ("Withdrawn", "Auto-rejected"): raise HTTPException(409, "You already applied to this job")
    sc, _, ms = match(c, j, s)  # ATS screening: same score the candidate sees
    rejected = sc is not None and sc < ATS_MIN
    st = "Auto-rejected" if rejected else ("Shortlisted" if sc is not None else "Applied")
    if a: a.status, a.resume_id, a.applied = st, r.id, datetime.utcnow()
    else:
        a = Application(job_id=jid, candidate_id=c.id, resume_id=r.id, status=st); s.add(a)
    s.flush(); t = None; co = jout(j, s)["company"]
    if rejected:
        s.add(Notification(user_id=u.id, message=f"{j.title}: auto-rejected ({sc}% match, {ATS_MIN}% needed). Missing: {', '.join(ms)}"[:250]))
    elif st == "Shortlisted":
        t = make_test(a, c, j, s)
        if t:
            s.add(Notification(user_id=u.id, message=f"Shortlisted for {j.title} at {co}. Your {t.total}-question test is ready on your Applications page."[:250]))
            bg.add_task(send_mail, u.email, f"Your skills test for {j.title} at {co}",
                f"Hi {u.name},\n\nYour profile matched {sc}% with {j.title} at {co}, so you are shortlisted.\n\nPlease complete your {t.total}-question test yourself:\n{FRONTEND_URL}/test/{t.token}\n\n"
                f"Log in with this email address to open it. You have {TEST_MINUTES} minutes once you start, you can take it once, and the link is valid for {LINK_DAYS} days.\n\nGood luck!\nMatchly")
        else:
            s.add(Notification(user_id=u.id, message=f"Shortlisted for {j.title} at {co}. The recruiter will share the next step."[:250]))
    s.commit()
    if rejected: msg = f"Auto-rejected: your match is {sc}% and {ATS_MIN}% is needed. Missing: {', '.join(ms)}."
    elif t: msg = f"Shortlisted! Your match is {sc}%. A {t.total}-question test link was sent to {u.email}. You can also open it from Applications."
    elif sc is not None: msg = f"Shortlisted! Your match is {sc}%. No test is ready for your skills yet, so the recruiter will contact you."
    else: msg = "Application submitted"
    return {"message": msg, "status": st, "score": sc, "missing": ms, "test": bool(t)}

@app.get("/applications")
def my_apps(u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s)
    return [{"id": a.id, "job": jout(s.get(Job, a.job_id), s), "status": a.status, "applied": a.applied.isoformat(), "test": test_info(a, s)}
            for a in s.query(Application).filter_by(candidate_id=c.id).order_by(Application.id.desc())]

@app.put("/applications/{aid}/withdraw")
def withdraw(aid: int, u=Depends(role("candidate")), s=Depends(db)):
    a = s.get(Application, aid)
    if not a or a.candidate_id != cand(u, s).id: raise HTTPException(404, "Application not found")
    if a.status not in ("Applied", "Under Review"): raise HTTPException(409, "This application can no longer be withdrawn")
    a.status = "Withdrawn"; s.commit(); return {"message": "Withdrawn"}

@app.put("/applications/{aid}/status")
def app_status(aid: int, d: St, u=Depends(role("recruiter")), s=Depends(db)):
    a = s.get(Application, aid); j = a and s.get(Job, a.job_id)
    if not a or j.recruiter_id != rec(u, s).id: raise HTTPException(404, "Application not found")
    if a.status in ("Withdrawn", "Auto-rejected"): raise HTTPException(409, "This application is closed (withdrawn or auto-rejected)")
    if d.status not in STATUSES: raise HTTPException(422, f"Status must be one of {STATUSES}")
    a.status = d.status
    s.add(Notification(user_id=s.get(Candidate, a.candidate_id).user_id, message=f"{j.title} at {jout(j, s)['company']}: your application is now {d.status}"))
    s.commit(); return {"message": "Status updated"}

@app.get("/recruiter/applicants")
def applicants(skill: str = "", min_exp: float = 0, auto: int = 0, u=Depends(role("recruiter")), s=Depends(db)):
    out = []
    q = s.query(Application, Job).join(Job, Job.id == Application.job_id).filter(Job.recruiter_id == rec(u, s).id)
    for a, j in q.order_by(Application.id.desc()):
        if (a.status == "Auto-rejected") != bool(auto): continue
        c = s.get(Candidate, a.candidate_id); cu = s.get(User, c.user_id)
        sk = skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s)
        m = re.search(r"\d+(\.\d+)?", c.experience or ""); yrs = float(m.group()) if m else 0
        if skill and not any(skill.lower() in x.lower() for x in sk): continue
        if yrs < min_exp: continue
        out.append({"id": a.id, "job": j.title, "name": cu.name, "email": cu.email, "phone": c.phone, "education": c.education,
                    "experience": c.experience, "skills": sk, "resume_id": a.resume_id, "status": a.status,
                    "score": match(c, j, s, {x.lower() for x in sk})[0], "job_id": j.id, "test": test_info(a, s)})
    return sorted(out, key=lambda x: -(x["score"] if x["score"] is not None else -1))


# ---------- Cloudinary test session recordings (7-day retention) ----------
def cloudinary_client():
    import cloudinary
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    if not all([cloud_name, api_key, api_secret]):
        raise HTTPException(503, "Video storage is not configured on the server")
    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret, secure=True)
    return cloudinary

def recording_playback_url(public_id):
    cloudinary = cloudinary_client()
    url, _ = cloudinary.utils.cloudinary_url(
        public_id, resource_type="video", type="authenticated",
        secure=True, sign_url=True, format="mp4"
    )
    return url

def delete_expired_recordings():
    """Delete expired Cloudinary videos, then remove their database rows."""
    try:
        import cloudinary.uploader
        cloudinary_client()
        s = Session()
        try:
            due = s.query(TestRecording).filter(TestRecording.expires_at <= datetime.utcnow()).all()
            for item in due:
                try:
                    result = cloudinary.uploader.destroy(
                        item.cloudinary_public_id, resource_type="video", type="authenticated",
                        invalidate=True
                    )
                    if result.get("result") in ("ok", "not found"):
                        s.delete(item)
                        s.commit()
                    else:
                        print("Recording expiry deletion will retry:", item.id, result.get("result"))
                except Exception as exc:
                    print("Recording expiry deletion failed; will retry:", item.id, str(exc))
        finally:
            s.close()
    except Exception as exc:
        print("Recording cleanup job error:", str(exc))

recording_scheduler = BackgroundScheduler(daemon=True)

@app.post("/tests/{token}/recording", status_code=201)
async def upload_test_recording(token: str, video: UploadFile = File(...),
                                u=Depends(role("candidate")), s=Depends(db)):
    t, application = owned_test(token, u, s)
    if t.status not in ("completed", "flagged_for_review"):
        raise HTTPException(409, "The test must be submitted or stopped before its recording is uploaded")
    candidate = cand(u, s)
    existing = s.query(TestRecording).filter_by(test_id=t.id).first()
    if existing:
        raise HTTPException(409, "A recording already exists for this test")
    content_type = (video.content_type or "").lower()
    if not content_type.startswith("video/"):
        raise HTTPException(415, "Please upload a video recording")
    data = await video.read()
    if not data:
        raise HTTPException(400, "The recording is empty")
    max_bytes = int(os.getenv("MAX_TEST_RECORDING_MB", "500")) * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(413, f"Recording exceeds the {max_bytes // (1024*1024)} MB limit")
    cloudinary = cloudinary_client()
    import cloudinary.uploader
    job = s.get(Job, application.job_id)
    recruiter = s.get(Recruiter, job.recruiter_id)
    try:
        uploaded = cloudinary.uploader.upload_large(
            io.BytesIO(data), resource_type="video", type="authenticated",
            folder="matchly/test-recordings",
            public_id=f"test-{t.id}-{uuid.uuid4().hex}",
            overwrite=False, chunk_size=6_000_000,
            context={"test_id": str(t.id), "candidate_id": str(candidate.id)}
        )
    except Exception as exc:
        print("Cloudinary upload failed:", str(exc))
        raise HTTPException(502, "Could not save the test recording. Please retry.")
    now = datetime.utcnow()
    item = TestRecording(
        test_id=t.id, application_id=application.id, candidate_id=candidate.id,
        recruiter_id=recruiter.id, cloudinary_public_id=uploaded["public_id"],
        created_at=now, expires_at=now + timedelta(days=7)
    )
    s.add(item)
    try:
        s.commit()
    except Exception:
        s.rollback()
        try:
            cloudinary.uploader.destroy(uploaded["public_id"], resource_type="video", type="authenticated", invalidate=True)
        except Exception:
            pass
        raise HTTPException(500, "Recording metadata could not be saved")
    return {"message": "Recording saved securely for 7 days", "expires_at": item.expires_at.isoformat()}

# ---------- next-round video assessments and recruiter meetings ----------
class VideoAssessmentActionIn(BaseModel):
    application_id: int
    kind: str  # video_assignment or meeting
    title: str
    instructions: Optional[str] = None
    due_at: Optional[datetime] = None
    meeting_at: Optional[datetime] = None
    meeting_url: Optional[str] = None

@app.get("/recruiter/video-assessment/passed")
def video_assessment_passed(u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    rows = (s.query(Application, Job, Candidate, User, Test)
        .join(Job, Job.id == Application.job_id)
        .join(Candidate, Candidate.id == Application.candidate_id)
        .join(User, User.id == Candidate.user_id)
        .join(Test, Test.application_id == Application.id)
        .filter(Job.recruiter_id == recruiter.id, Test.status == "completed")
        .order_by(Test.completed.desc(), Test.id.desc()).all())
    seen, result = set(), []
    for application, job, candidate, candidate_user, test in rows:
        if application.id in seen:
            continue
        seen.add(application.id)
        if not test.total or test.score is None or test.score < pass_mark(test.total):
            continue
        actions = s.query(VideoAssessmentAction).filter_by(application_id=application.id, recruiter_id=recruiter.id).order_by(VideoAssessmentAction.created_at.desc()).all()
        result.append({
            "application_id": application.id, "candidate_name": candidate_user.name,
            "candidate_email": candidate_user.email, "job": job.title,
            "score": test.score, "total": test.total,
            "passed_at": (test.completed or test.created).isoformat(),
            "actions": [{"id": x.id, "kind": x.kind, "title": x.title, "instructions": x.instructions,
                         "due_at": x.due_at.isoformat() if x.due_at else None,
                         "meeting_at": x.meeting_at.isoformat() if x.meeting_at else None,
                         "meeting_url": x.meeting_url, "livekit": bool(s.query(LiveInterviewRoom).filter_by(action_id=x.id).first()),
                         "status": x.status} for x in actions]
        })
    return result

@app.get("/candidate/video-assessment")
def candidate_video_assessment(u=Depends(role("candidate")), s=Depends(db)):
    candidate = cand(u, s)
    rows = (s.query(VideoAssessmentAction, Application, Job, Recruiter, User)
        .join(Application, Application.id == VideoAssessmentAction.application_id)
        .join(Job, Job.id == Application.job_id)
        .join(Recruiter, Recruiter.id == VideoAssessmentAction.recruiter_id)
        .join(User, User.id == Recruiter.user_id)
        .filter(Application.candidate_id == candidate.id)
        .order_by(VideoAssessmentAction.created_at.desc()).all())
    return [{"id": item.id, "kind": item.kind, "title": item.title, "instructions": item.instructions,
             "due_at": item.due_at.isoformat() if item.due_at else None,
             "meeting_at": item.meeting_at.isoformat() if item.meeting_at else None,
             "meeting_url": item.meeting_url, "livekit": bool(s.query(LiveInterviewRoom).filter_by(action_id=item.id).first()),
             "status": item.status, "job": job.title, "recruiter_name": recruiter_user.name}
            for item, application, job, recruiter, recruiter_user in rows]

@app.post("/recruiter/video-assessment/actions", status_code=201)
def create_video_assessment_action(d: VideoAssessmentActionIn, u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    application = s.get(Application, d.application_id)
    job = s.get(Job, application.job_id) if application else None
    if not application or not job or job.recruiter_id != recruiter.id:
        raise HTTPException(404, "Passed candidate application not found")
    if d.kind not in ("video_assignment", "meeting"):
        raise HTTPException(422, "Type must be video_assignment or meeting")
    if not d.title.strip():
        raise HTTPException(422, "Please enter a title")
    if d.kind == "video_assignment" and not (d.instructions or "").strip():
        raise HTTPException(422, "Please enter video assignment instructions")
    if d.kind == "meeting" and not d.meeting_at:
        raise HTTPException(422, "Please select a meeting date and time")
    item = VideoAssessmentAction(
        application_id=application.id, recruiter_id=recruiter.id, kind=d.kind,
        title=d.title.strip(), instructions=(d.instructions or "").strip() or None,
        due_at=d.due_at, meeting_at=d.meeting_at,
        meeting_url=(d.meeting_url or "").strip() or None
    )
    s.add(item)
    s.flush()
    if item.kind == "meeting":
        # The room is created lazily by LiveKit when the first participant joins.
        # Store an opaque UUID, never candidate names or email addresses in room names.
        s.add(LiveInterviewRoom(action_id=item.id, room_name=f"matchly-{uuid.uuid4().hex}"))
    candidate = s.get(Candidate, application.candidate_id)
    msg = (f"New video assessment: {item.title}" if item.kind == "video_assignment" else f"Recruiter meeting scheduled: {item.title}")
    s.add(Notification(user_id=candidate.user_id, message=msg[:250]))
    s.commit()
    return {"id": item.id, "message": "Video assessment action created and candidate notified"}

@app.get("/meetings/{action_id}/token")
def live_interview_token(action_id: int, u=Depends(me), s=Depends(db)):
    """Issue a short-lived LiveKit token only to the candidate or recruiter assigned to this meeting."""
    action = s.get(VideoAssessmentAction, action_id)
    if not action or action.kind != "meeting":
        raise HTTPException(404, "Interview meeting not found")
    application = s.get(Application, action.application_id)
    job = s.get(Job, application.job_id) if application else None
    if not application or not job:
        raise HTTPException(404, "Interview application not found")
    allowed = False
    if u.role == "candidate":
        candidate = cand(u, s)
        allowed = bool(candidate and application.candidate_id == candidate.id)
    elif u.role == "recruiter":
        recruiter = rec(u, s)
        allowed = bool(recruiter and job.recruiter_id == recruiter.id and action.recruiter_id == recruiter.id)
    if not allowed:
        raise HTTPException(403, "You are not invited to this interview")
    room = s.query(LiveInterviewRoom).filter_by(action_id=action.id).first()
    if not room:
        raise HTTPException(503, "This meeting does not have a LiveKit room. Create a new meeting invitation.")
    server_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    if not (server_url and api_key and api_secret):
        raise HTTPException(503, "LiveKit is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to backend/.env")
    try:
        from livekit import api as livekit_api
        token = (livekit_api.AccessToken(api_key, api_secret)
            .with_identity(f"matchly-user-{u.id}")
            .with_name(u.name)
            .with_grants(livekit_api.VideoGrants(
                room_join=True, room=room.room_name,
                can_publish=True, can_subscribe=True, can_publish_data=True
            ))
            .with_ttl(timedelta(minutes=15))
            .to_jwt())
    except ImportError:
        raise HTTPException(503, "LiveKit server SDK is missing. Install requirements.txt")
    except Exception as exc:
        print("LiveKit token generation failed:", str(exc))
        raise HTTPException(502, "Could not create a secure interview token")
    return {"server_url": server_url, "token": token, "room": room.room_name, "meeting_title": action.title}

@app.get("/recruiter/test-recordings")
def recruiter_test_recordings(u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    rows = (s.query(TestRecording, Test, Application, Job, Candidate, User)
        .join(Test, Test.id == TestRecording.test_id)
        .join(Application, Application.id == TestRecording.application_id)
        .join(Job, Job.id == Application.job_id)
        .join(Candidate, Candidate.id == TestRecording.candidate_id)
        .join(User, User.id == Candidate.user_id)
        .filter(TestRecording.recruiter_id == recruiter.id)
        .order_by(TestRecording.created_at.desc()).all())
    result = []
    for item, test, application, job, candidate, candidate_user in rows:
        if item.expires_at <= datetime.utcnow():
            continue
        result.append({
            "id": item.id, "test_id": test.id, "candidate_name": candidate_user.name,
            "candidate_email": candidate_user.email, "job": job.title,
            "recorded_at": item.created_at.isoformat(), "expires_at": item.expires_at.isoformat(),
            "playback_url": recording_playback_url(item.cloudinary_public_id)
        })
    return result

@app.delete("/recruiter/test-recordings/{recording_id}")
def delete_test_recording(recording_id: int, u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    item = s.query(TestRecording).filter_by(id=recording_id, recruiter_id=recruiter.id).first()
    if not item:
        raise HTTPException(404, "Recording not found")
    import cloudinary.uploader
    cloudinary_client()
    try:
        result = cloudinary.uploader.destroy(
            item.cloudinary_public_id, resource_type="video", type="authenticated", invalidate=True
        )
        if result.get("result") not in ("ok", "not found"):
            raise HTTPException(502, "Cloudinary could not delete the recording; please retry")
        s.delete(item)
        s.commit()
        return {"message": "Recording deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        print("Manual recording deletion failed:", str(exc))
        raise HTTPException(502, "Could not delete the recording; please retry")


# ---------- admin ----------
@app.get("/admin/analytics")
def analytics(u=Depends(role("admin")), s=Depends(db)):
    n = lambda m, **f: s.query(m).filter_by(**f).count()
    users = [x[0] for x in s.query(User.created).all()]; apps = s.query(Application.applied, Application.status).all()
    recent = [{"message": f"New {'job seeker' if x.role == 'candidate' else x.role} registered: {x.name}", "created": x.created.isoformat()}
              for x in s.query(User).filter(User.role != "admin").order_by(User.id.desc()).limit(5)]
    return {"users": n(User), "candidates": n(User, role="candidate"), "recruiters": n(User, role="recruiter"),
            "jobs": n(Job), "active_jobs": n(Job, status="published"), "applications": n(Application),
            "auto_rejected": sum(1 for _, st in apps if st == "Auto-rejected"),
            "users_delta": wow(users), "applications_delta": wow([a for a, _ in apps]), "recent": recent}

@app.get("/admin/users")
def users(u=Depends(role("admin")), s=Depends(db)):
    return [{"id": x.id, "name": x.name, "email": x.email, "role": x.role, "active": x.active} for x in s.query(User).order_by(User.id)]

class Act(BaseModel): active: bool

@app.put("/admin/users/{uid}/active")
def toggle(uid: int, d: Act, u=Depends(role("admin")), s=Depends(db)):
    t = s.get(User, uid)
    if not t: raise HTTPException(404, "User not found")
    if t.id == u.id: raise HTTPException(409, "You cannot disable your own account")
    t.active = d.active; s.commit(); return {"message": "Updated"}

@app.get("/admin/jobs")
def admin_jobs(u=Depends(role("admin")), s=Depends(db)):
    return [jout(j, s) for j in s.query(Job).order_by(Job.id.desc())]


# ---------- complete admin control center ----------
@app.get("/admin/candidates")
def admin_candidates(u=Depends(role("admin")), s=Depends(db)):
    """All job seekers with profile, skills, resume metadata and application counts."""
    out = []
    for c in s.query(Candidate).order_by(Candidate.id.desc()).all():
        user = s.get(User, c.user_id)
        if not user:
            continue
        resumes = s.query(Resume).filter_by(candidate_id=c.id).order_by(Resume.id.desc()).all()
        apps = s.query(Application).filter_by(candidate_id=c.id).all()
        out.append({
            "id": c.id, "user_id": user.id, "name": user.name, "email": user.email,
            "active": user.active, "created": user.created.isoformat() if user.created else None,
            "phone": c.phone or "", "education": c.education or "",
            "experience": c.experience or "", "summary": c.summary or "",
            "skills": skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s),
            "applications": len(apps),
            "shortlisted": sum(1 for a in apps if a.status == "Shortlisted"),
            "selected": sum(1 for a in apps if a.status == "Selected"),
            "resumes": [{"id": r.id, "filename": r.filename, "status": r.status,
                         "uploaded": r.uploaded.isoformat() if r.uploaded else None,
                         "error": r.error or ""} for r in resumes]
        })
    return out


@app.get("/admin/companies")
def admin_companies(u=Depends(role("admin")), s=Depends(db)):
    """Company directory with recruiter and job-posting details."""
    out = []
    for company in s.query(Company).order_by(Company.id.desc()).all():
        recruiters = s.query(Recruiter).filter_by(company_id=company.id).all()
        recruiter_rows = []
        jobs = []
        for recruiter in recruiters:
            user = s.get(User, recruiter.user_id)
            if user:
                recruiter_rows.append({"id": user.id, "name": user.name, "email": user.email, "active": user.active})
            for job in s.query(Job).filter_by(recruiter_id=recruiter.id).order_by(Job.id.desc()).all():
                counts = Counter(a.status for a in s.query(Application).filter_by(job_id=job.id).all())
                jobs.append({**jout(job, s), "applications": sum(counts.values()),
                             "shortlisted": counts.get("Shortlisted", 0),
                             "interview": counts.get("Interview", 0),
                             "selected": counts.get("Selected", 0)})
        out.append({"id": company.id, "name": company.name, "description": company.description or "",
                    "contact": company.contact or "", "recruiters": recruiter_rows,
                    "recruiter_count": len(recruiter_rows), "jobs": jobs, "job_count": len(jobs)})
    return out


@app.get("/admin/applications")
def admin_applications(status: str = "", u=Depends(role("admin")), s=Depends(db)):
    """All applications across the platform, with ATS and test information."""
    out = []
    query = s.query(Application).order_by(Application.id.desc())
    if status:
        query = query.filter(Application.status == status)
    for a in query.all():
        c = s.get(Candidate, a.candidate_id)
        j = s.get(Job, a.job_id)
        if not c or not j:
            continue
        candidate_user = s.get(User, c.user_id)
        recruiter = s.get(Recruiter, j.recruiter_id)
        recruiter_user = s.get(User, recruiter.user_id) if recruiter else None
        company = s.get(Company, recruiter.company_id) if recruiter else None
        resume = s.get(Resume, a.resume_id)
        out.append({
            "id": a.id, "status": a.status,
            "applied": a.applied.isoformat() if a.applied else None,
            "candidate": {"id": c.id, "name": candidate_user.name if candidate_user else "",
                          "email": candidate_user.email if candidate_user else "", "phone": c.phone or "",
                          "education": c.education or "", "experience": c.experience or "",
                          "skills": skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s)},
            "job": {"id": j.id, "title": j.title, "status": j.status},
            "company": company.name if company else "",
            "recruiter": recruiter_user.name if recruiter_user else "",
            "resume_id": resume.id if resume else None,
            "resume_filename": resume.filename if resume else "",
            "match_score": match(c, j, s)[0],
            "test": test_info(a, s)
        })
    return out


@app.get("/admin/resumes")
def admin_resumes(u=Depends(role("admin")), s=Depends(db)):
    """Resume index. Actual file access remains protected by /resume/{rid}/file."""
    out = []
    for r in s.query(Resume).order_by(Resume.id.desc()).all():
        c = s.get(Candidate, r.candidate_id)
        user = s.get(User, c.user_id) if c else None
        out.append({"id": r.id, "candidate_id": c.id if c else None,
                    "candidate_name": user.name if user else "", "candidate_email": user.email if user else "",
                    "filename": r.filename, "status": r.status,
                    "uploaded": r.uploaded.isoformat() if r.uploaded else None,
                    "error": r.error or ""})
    return out

# ---------- matching, insights, saved jobs, notifications ----------
def match(c, j, s, have=None):
    """Returns (score, matched, missing). Score = matched required skills / all required skills."""
    have = have if have is not None else {x.lower() for x in skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s)}
    req = skill_names(JobSkill, JobSkill.job_id, j.id, s)
    if not req: return None, [], []
    m = [x for x in req if x.lower() in have]; ms = [x for x in req if x.lower() not in have]
    return round(100 * len(m) / len(req)), m, ms

def day_series(dates, n=14):
    today = datetime.utcnow().date(); days = [today - timedelta(days=i) for i in range(n - 1, -1, -1)]
    c = Counter(d.date() for d in dates if d)
    return [d.strftime("%d %b") for d in days], [c.get(d, 0) for d in days]

def wow(dates):
    """Percent change: last 7 days versus the 7 days before. None when there is nothing to compare."""
    now = datetime.utcnow()
    cur = sum(1 for d in dates if d and now - d <= timedelta(days=7))
    prev = sum(1 for d in dates if d and timedelta(days=7) < now - d <= timedelta(days=14))
    return round(100 * (cur - prev) / prev) if prev else None

@app.get("/candidate/insights")
def insights(u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); have = {x.lower() for x in skill_names(CandidateSkill, CandidateSkill.candidate_id, c.id, s)}
    rows, gaps = [], Counter()
    for j in s.query(Job).filter_by(status="published"):
        sc, m, ms = match(c, j, s, have)
        if not sc: continue
        rows.append({"job": jout(j, s), "score": sc, "matched": m, "missing": ms})
        if sc >= 30: gaps.update(ms)
    rows.sort(key=lambda r: -r["score"])
    apps = s.query(Application).filter_by(candidate_id=c.id).all()
    checks = [("Phone", c.phone), ("Education", c.education), ("Experience", c.experience), ("Summary", c.summary), ("Skills", have)]
    fields = [{"label": k, "done": bool(v.strip() if isinstance(v, str) else v)} for k, v in checks]
    r = s.query(Resume).filter_by(candidate_id=c.id).order_by(Resume.id.desc()).first()
    labels, data = day_series([a.applied for a in apps]); top = [x["score"] for x in rows[:6]]
    return {"recommended": rows[:6], "gaps": [{"skill": k, "count": v} for k, v in gaps.most_common(5)], "fields": fields,
            "resume": r and {"filename": r.filename, "status": r.status}, "trend": {"labels": labels, "data": data},
            "stats": {"applications": len(apps), "applications_delta": wow([a.applied for a in apps]),
                      "saved": s.query(SavedJob).filter_by(candidate_id=c.id).count(),
                      "profile": round(100 * sum(f["done"] for f in fields) / 5), "avg_match": round(sum(top) / len(top)) if top else 0}}

@app.post("/jobs/{jid}/save")
def save_job(jid: int, u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); x = s.get(SavedJob, (c.id, jid))
    if x: s.delete(x); on = False
    else:
        if not s.get(Job, jid): raise HTTPException(404, "Job not found")
        s.add(SavedJob(candidate_id=c.id, job_id=jid)); on = True
    s.commit(); return {"saved": on}

@app.get("/saved")
def saved(u=Depends(role("candidate")), s=Depends(db)):
    c = cand(u, s); out = []
    for x in s.query(SavedJob).filter_by(candidate_id=c.id):
        j = s.get(Job, x.job_id)
        if j and j.status == "published": out.append(jout(j, s))
    return out

@app.get("/notifications")
def notifications(u=Depends(me), s=Depends(db)):
    q = s.query(Notification).filter_by(user_id=u.id).order_by(Notification.id.desc()).limit(15).all()
    return {"unread": sum(1 for n in q if not n.read),
            "items": [{"id": n.id, "message": n.message, "read": n.read, "created": n.created.isoformat()} for n in q]}

@app.put("/notifications/read")
def notifications_read(u=Depends(me), s=Depends(db)):
    s.query(Notification).filter_by(user_id=u.id, read=False).update({"read": True}); s.commit()
    return {"message": "ok"}

# ---------- recruiter stats and export ----------
@app.get("/recruiter/stats")
def recruiter_stats(u=Depends(role("recruiter")), s=Depends(db)):
    r = rec(u, s); jobs_ = s.query(Job).filter_by(recruiter_id=r.id).all()
    rows = s.query(Application, Job).join(Job, Job.id == Application.job_id).filter(Job.recruiter_id == r.id).all()
    apps = [a for a, _ in rows]; by = Counter(a.status for a in apps); per = Counter(a.job_id for a in apps)
    labels, data = day_series([a.applied for a in apps])
    scores = [x["score"] for x in applicants("", 0, 0, u, s) if x["score"] is not None]
    recent = []
    for a, j in sorted(rows, key=lambda x: x[0].applied or datetime.min, reverse=True)[:5]:
        cu = s.get(User, s.get(Candidate, a.candidate_id).user_id)
        recent.append({"message": f"{cu.name} applied to {j.title}", "created": a.applied.isoformat() if a.applied else None})
    return {"jobs": len(jobs_), "active": sum(1 for j in jobs_ if j.status == "published"), "applicants": len(apps),
            "applicants_delta": wow([a.applied for a in apps]), "shortlisted": by.get("Shortlisted", 0),
            "avg_match": round(sum(scores) / len(scores)) if scores else 0, "auto_rejected": by.get("Auto-rejected", 0),
            "stages": [{"label": k, "value": by.get(k, 0)} for k in STATUSES + ["Auto-rejected", "Withdrawn"]],
            "per_job": [{"label": j.title, "value": per.get(j.id, 0)} for j in jobs_],
            "trend": {"labels": labels, "data": data}, "recent": recent}

@app.get("/recruiter/export")
def recruiter_export(u=Depends(role("recruiter")), s=Depends(db)):
    from openpyxl import Workbook
    wb = Workbook(); ws = wb.active; ws.title = "Applicants"
    ws.append(["Name", "Email", "Phone", "Job", "Match %", "Experience", "Education", "Skills", "Status", "Test score"])
    for a in applicants("", 0, 0, u, s):
        ws.append([a["name"], a["email"], a["phone"], a["job"], a["score"], a["experience"], a["education"], ", ".join(a["skills"]), a["status"],
                   (f'{a["test"]["score"]}/{a["test"]["total"]}' if a["test"] and a["test"]["status"] == "completed" else (a["test"]["status"] if a["test"] else ""))])
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=applicants.xlsx"})

# ---------- admin trends ----------
@app.get("/admin/trends")
def trends(u=Depends(role("admin")), s=Depends(db)):
    today = datetime.utcnow().date(); days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    su = Counter(x.created.date() for x in s.query(User) if x.created)
    ap = Counter(x.applied.date() for x in s.query(Application) if x.applied)
    return {"labels": [d.strftime("%d %b") for d in days], "signups": [su.get(d, 0) for d in days], "applications": [ap.get(d, 0) for d in days]}

@app.get("/public/stats")
def public_stats(s=Depends(db)):
    return {"jobs": s.query(Job).filter_by(status="published").count(), "companies": s.query(Company).count(), "seekers": s.query(Candidate).count()}

@app.get("/admin/health")
def health(u=Depends(role("admin")), s=Depends(db)):
    from sqlalchemy import text
    try: s.execute(text("SELECT 1")); ok = True
    except Exception: ok = False
    files = [os.path.join("uploads", f) for f in os.listdir("uploads")] if os.path.isdir("uploads") else []
    return {"api": True, "database": ok, "storage": os.access("uploads", os.W_OK), "files": len(files),
            "mb": round(sum(os.path.getsize(f) for f in files if os.path.isfile(f)) / 1048576, 2)}

# ---------- skills tests ----------
def send_mail(to, subject, body):
    host = os.getenv("SMTP_HOST")
    if not host:
        print(f"\n[EMAIL not configured, printed instead]\nTo: {to}\nSubject: {subject}\n\n{body}\n"); return
    from email.message import EmailMessage; import smtplib
    m = EmailMessage(); m["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER", ""); m["To"] = to; m["Subject"] = subject; m.set_content(body)
    try:
        with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=20) as srv:
            srv.starttls(); srv.login(os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASS", "")); srv.send_message(m)
    except Exception as e: print("[EMAIL failed]", e)

def pick_questions(c, j, s):
    """Pick 20 random questions only from this job's question set."""
    pool = s.query(Question).filter(Question.job_id == j.id).all()
    if len(pool) < 50:
        return [], []
    chosen = random.sample(pool, TEST_SIZE)
    used = sorted({q.tech for q in chosen if q.tech})
    return chosen, used


def create_test_attempt(a, c, j, s):
    """Create a separate test row so earlier attempts and their evidence remain intact."""
    qs, used = pick_questions(c, j, s)
    if len(qs) != TEST_SIZE:
        return None
    t = Test(application_id=a.id, token=secrets.token_urlsafe(24), tech=", ".join(used),
             question_ids=[q.id for q in qs], total=TEST_SIZE,
             status="pending", expires=datetime.utcnow() + timedelta(days=LINK_DAYS))
    s.add(t)
    s.flush()
    return t


def make_test(a, c, j, s):
    # Initial application flow reuses the latest attempt if one already exists.
    existing = s.query(Test).filter_by(application_id=a.id).order_by(Test.id.desc()).first()
    if existing:
        return existing
    return create_test_attempt(a, c, j, s)


def test_info(a, s):
    t = s.query(Test).filter_by(application_id=a.id).order_by(Test.id.desc()).first()
    if not t:
        return None
    if t.status == "pending" and t.expires and datetime.utcnow() > t.expires:
        t.status = "expired"
        s.commit()
    return {"id": t.id, "token": t.token, "status": t.status, "score": t.score, "total": t.total,
            "pass_mark": pass_mark(t.total), "passed": t.status == "completed" and
            t.score is not None and t.score >= pass_mark(t.total)}

def owned_test(token, u, s):
    t = s.query(Test).filter_by(token=token).first(); a = t and s.get(Application, t.application_id)
    if not t or s.get(Candidate, a.candidate_id).user_id != u.id: raise HTTPException(404, "Test not found. Log in with the account that applied.")
    return t, a

def finish(t, answers, s):
    qs = {q.id: q for q in s.query(Question).filter(Question.id.in_(t.question_ids))}
    t.answers = answers
    t.score = sum(1 for i in t.question_ids if i in qs and answers.get(str(i)) == qs[i].answer)
    t.status, t.completed = "completed", datetime.utcnow()
    for ps in s.query(ProctoringSession).filter_by(test_id=t.id, status="active").all():
        ps.status, ps.ended_at = "completed", datetime.utcnow()
    s.commit()

@app.get("/tests/{token}")
def test_get(token: str, u=Depends(role("candidate")), s=Depends(db)):
    t, a = owned_test(token, u, s); j = s.get(Job, a.job_id)
    if t.status == "pending" and datetime.utcnow() > t.expires: t.status = "expired"; s.commit()
    return {"job": j.title, "company": jout(j, s)["company"], "status": t.status, "total": t.total, "minutes": TEST_MINUTES, "tech": t.tech, "score": t.score, "pass_mark": pass_mark(t.total)}


@app.post("/tests/{token}/start")
def test_start(token: str, u=Depends(role("candidate")), s=Depends(db)):
    t, a = owned_test(token, u, s)

    if t.status == "flagged_for_review":
        raise HTTPException(409, "This attempt was stopped and is awaiting recruiter review")
    if t.status == "completed":
        raise HTTPException(409, "You have already completed this test")

    if t.status == "expired" or (
        t.status == "pending" and datetime.utcnow() > t.expires
    ):
        t.status = "expired"
        s.commit()
        raise HTTPException(410, "This test link has expired")

    if t.status == "pending":
        t.status = "started"
        t.started = datetime.utcnow()
        s.commit()

    left = int(
        (t.started + timedelta(minutes=TEST_MINUTES) - datetime.utcnow())
        .total_seconds()
    )

    if left <= 0:
        finish(t, {}, s)
        raise HTTPException(410, "Time is over for this test")

    # Create or reuse the active proctoring session
    proctor_session = (
        s.query(ProctoringSession)
        .filter_by(
            test_id=t.id,
            candidate_id=a.candidate_id,
            status="active"
        )
        .first()
    )

    if not proctor_session:
        proctor_session = ProctoringSession(
            test_id=t.id,
            candidate_id=a.candidate_id,
            status="active"
        )
        s.add(proctor_session)
        s.commit()
        s.refresh(proctor_session)

    qs = {
        q.id: q
        for q in s.query(Question)
        .filter(Question.id.in_(t.question_ids))
    }
    warning_count = s.query(ProctoringEvent).filter_by(session_id=proctor_session.id).count()

    return {
        "seconds": left,
        "answers": {},
        "warning_count": warning_count,
        "proctoring_session_id": proctor_session.id,
        "questions": [
            {
                "id": i,
                "text": qs[i].text,
                "options": {
                    "A": qs[i].a,
                    "B": qs[i].b,
                    "C": qs[i].c,
                    "D": qs[i].d
                }
            }
            for i in t.question_ids if i in qs
        ]
    }


# ================= PROCTORING EVENT API =================

class ProctoringEventIn(BaseModel):
    session_id: int
    event_type: str
    description: Optional[str] = None


@app.post("/tests/{token}/proctoring/events")
def create_proctoring_event(token: str, data: ProctoringEventIn,
                            u=Depends(role("candidate")), s=Depends(db)):
    t, a = owned_test(token, u, s)
    allowed_events = {"tab_switch", "fullscreen_exit", "face_not_detected",
                      "multiple_faces", "camera_disabled", "phone_detected"}
    if data.event_type not in allowed_events:
        raise HTTPException(400, "Invalid proctoring event type")
    if t.status != "started":
        raise HTTPException(409, "This test attempt is no longer active")

    proctor_session = s.query(ProctoringSession).filter_by(
        id=data.session_id, test_id=t.id, candidate_id=a.candidate_id, status="active"
    ).first()
    if not proctor_session:
        raise HTTPException(404, "Active proctoring session not found")

    event = ProctoringEvent(session_id=proctor_session.id, event_type=data.event_type,
                            description=data.description)
    s.add(event)
    s.flush()
    warning_count = s.query(ProctoringEvent).filter_by(session_id=proctor_session.id).count()
    terminated = warning_count >= 3
    if terminated:
        t.status, t.completed = "flagged_for_review", datetime.utcnow()
        proctor_session.status, proctor_session.ended_at = "flagged", datetime.utcnow()
        candidate = s.get(Candidate, a.candidate_id)
        if candidate:
            s.add(Notification(user_id=candidate.user_id,
                message="Your test attempt was stopped after three monitoring warnings and is awaiting recruiter review."))
    s.commit()
    return {
        "message": ("Attempt stopped after three warnings. The recruiter will review the recorded events."
                    if terminated else f"Monitoring warning {warning_count} of 3. This event is recorded for recruiter review."),
        "event_id": event.id, "event_type": event.event_type,
        "warning_count": warning_count, "warning_limit": 3,
        "terminated": terminated, "status": t.status
    }


@app.get("/recruiter/proctoring/reviews")
def recruiter_proctoring_reviews(u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    rows = (s.query(Test, Application, Job, Candidate, User)
            .join(Application, Application.id == Test.application_id)
            .join(Job, Job.id == Application.job_id)
            .join(Candidate, Candidate.id == Application.candidate_id)
            .join(User, User.id == Candidate.user_id)
            .filter(Job.recruiter_id == recruiter.id, Test.status == "flagged_for_review")
            .order_by(Test.id.desc()).all())
    out = []
    for t, a, j, c, candidate_user in rows:
        sessions = s.query(ProctoringSession).filter_by(test_id=t.id).order_by(ProctoringSession.id.desc()).all()
        event_rows = []
        for ps in sessions:
            for ev in s.query(ProctoringEvent).filter_by(session_id=ps.id).order_by(ProctoringEvent.created_at.asc()).all():
                event_rows.append({"id": ev.id, "type": ev.event_type,
                    "description": ev.description or "",
                    "created_at": ev.created_at.isoformat() if ev.created_at else None})
        out.append({"test_id": t.id, "application_id": a.id, "candidate_name": candidate_user.name,
            "candidate_email": candidate_user.email, "job": j.title, "attempt_status": t.status,
            "attempt_created": t.created.isoformat() if t.created else None,
            "warning_count": len(event_rows), "events": event_rows})
    return out


@app.post("/recruiter/tests/{test_id}/reattempt")
def allow_test_reattempt(test_id: int, u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    previous = s.get(Test, test_id)
    application = previous and s.get(Application, previous.application_id)
    job = application and s.get(Job, application.job_id)
    if not previous or not application or not job or job.recruiter_id != recruiter.id:
        raise HTTPException(404, "Test attempt not found")
    if previous.status != "flagged_for_review":
        raise HTTPException(409, "Only attempts flagged for recruiter review can be reopened")
    latest = s.query(Test).filter_by(application_id=application.id).order_by(Test.id.desc()).first()
    if latest and latest.id != previous.id:
        raise HTTPException(409, "A newer test attempt already exists")
    candidate = s.get(Candidate, application.candidate_id)
    candidate_user = s.get(User, candidate.user_id)
    fresh = create_test_attempt(application, candidate, job, s)
    if not fresh:
        raise HTTPException(422, "This job does not have enough questions to create a new test")
    if application.status in ("Rejected", "Withdrawn", "Auto-rejected"):
        application.status = "Shortlisted"
    previous.status = "reattempt_allowed"
    s.add(Notification(user_id=candidate_user.id,
        message=f"The recruiter approved a fresh skills-test attempt for {job.title}. Check your Applications page."))
    s.commit()
    send_mail(candidate_user.email, f"New skills test attempt: {job.title}",
        f"Hi {candidate_user.name},\n\nThe recruiter approved a fresh attempt for your {job.title} assessment.\n\nOpen: {FRONTEND_URL}/test/{fresh.token}\n\nYour previous attempt and monitoring history remain on record.\n\nMatchly")
    return {"message": "Fresh test attempt created", "token": fresh.token, "test_id": fresh.id}


@app.post("/recruiter/tests/{test_id}/disqualify")
def disqualify_test_attempt(test_id: int, u=Depends(role("recruiter")), s=Depends(db)):
    recruiter = rec(u, s)
    previous = s.get(Test, test_id)
    application = previous and s.get(Application, previous.application_id)
    job = application and s.get(Job, application.job_id)
    if not previous or not application or not job or job.recruiter_id != recruiter.id:
        raise HTTPException(404, "Test attempt not found")
    if previous.status != "flagged_for_review":
        raise HTTPException(409, "Only attempts flagged for recruiter review can be disqualified")
    application.status = "Rejected"
    previous.status = "disqualified"
    candidate = s.get(Candidate, application.candidate_id)
    s.add(Notification(user_id=candidate.user_id,
        message=f"Your application for {job.title} was marked Rejected after recruiter review of the test attempt."))
    s.commit()
    return {"message": "Application marked Rejected"}


class Sub(BaseModel): answers: dict

def pass_mark(total):
    return max(1, -(-total * PASS_PERCENT // 100))  # rounded up

@app.post("/tests/{token}/submit")
def test_submit(token: str, d: Sub, bg: BackgroundTasks, u=Depends(role("candidate")), s=Depends(db)):
    t, a = owned_test(token, u, s)
    if t.status == "flagged_for_review": raise HTTPException(409, "This attempt was stopped and is awaiting recruiter review")
    if t.status == "completed": raise HTTPException(409, "You have already completed this test")
    if t.status != "started": raise HTTPException(409, "Start the test first")
    if datetime.utcnow() > t.started + timedelta(minutes=TEST_MINUTES, seconds=60):
        finish(t, {}, s); raise HTTPException(410, "Time is over. The test was closed.")
    finish(t, {str(k): str(v).upper() for k, v in d.answers.items() if v}, s)
    need = pass_mark(t.total); passed = t.score >= need; j = s.get(Job, a.job_id); co = jout(j, s)["company"]
    answered = len(t.answers or {})
    if passed:
        if a.status == "Shortlisted": a.status = "Interview"  # next round; never overrides a recruiter's later decision
        s.add(Notification(user_id=u.id, message=f"{j.title} at {co}: you passed the test ({t.score}/{t.total}) and are selected for the next round."[:250]))
        msg = "Congratulations! You have been selected for the next round. The recruiter will contact you."
        bg.add_task(send_mail, u.email, f"You are selected for the next round: {j.title}",
            f"Hi {u.name},\n\nCongratulations! You scored {t.score}/{t.total} in your test for {j.title} at {co}, which is above the passing mark of {need}.\n\nYou have been selected for the next round. The recruiter will contact you soon.\n\nMatchly")
    else:
        s.add(Notification(user_id=u.id, message=f"{j.title} at {co}: test score {t.score}/{t.total}. The passing mark is {need}. The recruiter will review your result."[:250]))
        msg = f"You scored {t.score}/{t.total}. The passing mark is {need}, so you did not reach it this time. The recruiter will review your result."
    s.commit()
    return {"score": t.score, "total": t.total, "passed": passed, "pass_mark": need, "percent": round(100 * t.score / t.total),
            "correct": t.score, "wrong": answered - t.score, "unanswered": t.total - answered, "message": msg}

def read_question_upload(data: bytes, filename: str):
    """Read CSV/XLSX rows in the order: technology, question, options A-D, answer."""
    name = (filename or "").lower()
    try:
        if name.endswith(".xlsx"):
            from openpyxl import load_workbook
            workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            rows = [["" if v is None else str(v).strip() for v in row]
                    for row in workbook.active.iter_rows(values_only=True)]
            workbook.close()
        elif name.endswith(".csv"):
            rows = [[v.strip() for v in row]
                    for row in csv.reader(io.StringIO(data.decode("utf-8-sig")))]
        else:
            raise HTTPException(415, "Upload a .csv or .xlsx file")
    except HTTPException:
        raise
    except UnicodeDecodeError:
        raise HTTPException(422, "CSV must use UTF-8 encoding")
    except Exception as exc:
        raise HTTPException(422, f"Could not read the question file: {str(exc)[:160]}")
    return rows


@app.get("/jobs/{jid}/questions")
def job_question_status(jid: int, u=Depends(role("recruiter", "admin")), s=Depends(db)):
    j = s.get(Job, jid)
    if not j:
        raise HTTPException(404, "Job not found")
    if u.role == "recruiter" and j.recruiter_id != rec(u, s).id:
        raise HTTPException(403, "This is not your job posting")
    questions = s.query(Question).filter(Question.job_id == jid).order_by(Question.id.asc()).all()
    count = len(questions)
    items = [{"id": q.id, "tech": q.tech, "text": q.text, "a": q.a, "b": q.b, "c": q.c, "d": q.d, "answer": q.answer} for q in questions]
    return {"job_id": jid, "count": count, "required": 50, "ready": count >= 50, "items": items}


@app.post("/jobs/{jid}/questions/import")
async def import_job_questions(jid: int, f: UploadFile = File(...),
                               u=Depends(role("recruiter")), s=Depends(db)):
    j = s.get(Job, jid)
    if not j:
        raise HTTPException(404, "Job not found")
    if j.recruiter_id != rec(u, s).id:
        raise HTTPException(403, "This is not your job posting")
    data = await f.read()
    if not data:
        raise HTTPException(422, "The uploaded file is empty")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Question file must be 10 MB or smaller")
    rows = read_question_upload(data, f.filename or "")
    if len(rows) < 2:
        raise HTTPException(422, "The file must contain a header row and at least one question")
    added = skipped = 0
    company_id = rec(u, s).company_id
    for row in rows[1:]:
        vals = (row + [""] * 7)[:7]
        tech, question, option_a, option_b, option_c, option_d, answer = [v.strip() for v in vals]
        answer = answer.upper()
        if not all((tech, question, option_a, option_b, option_c, option_d)) or answer not in ("A", "B", "C", "D"):
            skipped += 1
            continue
        s.add(Question(job_id=jid, company_id=company_id, tech=tech[:60], text=question,
                       a=option_a, b=option_b, c=option_c, d=option_d, answer=answer))
        added += 1
    if added == 0:
        raise HTTPException(422, "No valid questions found. Each row needs technology, question, four options, and answer A/B/C/D.")
    s.commit()
    total = s.query(Question).filter(Question.job_id == jid).count()
    return {"added": added, "skipped": skipped, "count": total, "required": 50,
            "ready": total >= 50, "message": f"Added {added} questions. This job now has {total}/50 valid questions."}


@app.put("/jobs/{jid}/questions/{qid}")
def update_job_question(jid: int, qid: int, data: QuestionUpdate,
                        u=Depends(role("recruiter")), s=Depends(db)):
    j = s.get(Job, jid)
    if not j:
        raise HTTPException(404, "Job not found")
    if j.recruiter_id != rec(u, s).id:
        raise HTTPException(403, "This is not your job posting")
    q = s.query(Question).filter(Question.id == qid, Question.job_id == jid).first()
    if not q:
        raise HTTPException(404, "Question not found for this job")
    answer = data.answer.upper().strip()
    values = [data.text.strip(), data.a.strip(), data.b.strip(), data.c.strip(), data.d.strip()]
    if not all(values) or answer not in ("A", "B", "C", "D"):
        raise HTTPException(422, "Question, all four options, and a correct answer A/B/C/D are required")
    q.text, q.a, q.b, q.c, q.d, q.answer = values[0], values[1], values[2], values[3], values[4], answer
    s.commit()
    return {"message": "Question updated successfully", "id": q.id}


@app.post("/questions/import")
async def import_questions(f: UploadFile = File(...), u=Depends(role("recruiter", "admin")), s=Depends(db)):
    data = await f.read(); co = rec(u, s).company_id if u.role == "recruiter" else None; name = (f.filename or "").lower()
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        rows = [["" if v is None else str(v) for v in r] for r in load_workbook(io.BytesIO(data), read_only=True).active.iter_rows(values_only=True)]
    elif name.endswith(".csv"): rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    else: raise HTTPException(415, "Upload a .csv or .xlsx file")
    added = skipped = 0
    for r in rows[1:]:  # first row is the header
        tech, q, a, b, c, d, ans = ([x.strip() for x in r] + [""] * 7)[:7]
        if not (tech and q and a and b) or ans.upper() not in ("A", "B", "C", "D"): skipped += 1; continue
        s.add(Question(company_id=co, tech=tech, text=q, a=a, b=b, c=c, d=d, answer=ans.upper())); added += 1
    s.commit(); return {"added": added, "skipped": skipped}

@app.get("/questions/stats")
def question_stats(u=Depends(role("recruiter", "admin")), s=Depends(db)):
    co = rec(u, s).company_id if u.role == "recruiter" else None; out = {}
    for tech, cid, n in s.query(Question.tech, Question.company_id, func.count()).group_by(Question.tech, Question.company_id).all():
        o = out.setdefault(tech.lower(), {"tech": tech, "mine": 0, "shared": 0})
        if cid is None: o["shared"] += n
        elif cid == co: o["mine"] += n
    return {"items": sorted(out.values(), key=lambda x: x["tech"].lower()), "test_size": TEST_SIZE}
