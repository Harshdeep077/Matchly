"""Adds test recruiters, job seekers, jobs, resumes and applications.
Also spreads dates over 14 days and adds extra applications for charts. Safe to run twice."""
import os, uuid, random, bcrypt, fitz
from datetime import datetime, timedelta
from models import *

Base.metadata.create_all(engine)
os.makedirs("uploads", exist_ok=True)
s = Session()
PW = "Test@1234"

def user(name, email, role):
    if s.query(User).filter_by(email=email).first(): return None
    u = User(name=name, email=email, role=role, password_hash=bcrypt.hashpw(PW.encode(), bcrypt.gensalt()).decode())
    s.add(u); s.flush(); return u

def link(model, key, owner_id, names):
    for n in names:
        sk = s.query(Skill).filter_by(name=n).first() or Skill(name=n)
        s.add(sk); s.flush(); s.add(model(**{key: owner_id, "skill_id": sk.id}))

RECRUITERS = [
 ("Riya Sharma", "riya@novatech.com", "NovaTech Solutions", "Product company building SaaS tools.", [
  ("Backend Developer (Python)", "Build REST APIs with FastAPI and MySQL for our SaaS platform.", "Ludhiana", 1, 3, "Full-time", "6-9 LPA", ["Python", "FastAPI", "MySQL", "Docker"]),
  ("Frontend Developer", "Create fast, accessible interfaces in React.", "Remote", 1, 4, "Full-time", "5-8 LPA", ["React", "JavaScript", "HTML", "CSS", "Redux"]),
  ("Full Stack Intern", "Learn by shipping real features with our team.", "Chandigarh", 0, 1, "Internship", "15k per month", ["Python", "React", "SQL"]),
  ("DevOps Engineer", "Own our CI/CD and cloud setup.", "Bengaluru", 3, 6, "Full-time", "12-18 LPA", ["Docker", "AWS", "Linux", "Git"])]),
 ("Amit Verma", "amit@pixelcraft.com", "PixelCraft Studio", "Design and web agency for growing brands.", [
  ("UI Developer", "Turn Figma designs into pixel-perfect pages.", "Mohali", 0, 2, "Full-time", "4-6 LPA", ["HTML", "CSS", "JavaScript", "Figma"]),
  ("React Developer", "Build client dashboards with React and TypeScript.", "Remote", 2, 5, "Contract", "8-12 LPA", ["React", "TypeScript", "Tailwind", "Git"]),
  ("Node.js Developer", "Design APIs and services for client apps.", "Pune", 2, 4, "Full-time", "7-11 LPA", ["Node.js", "MongoDB", "REST", "JavaScript"]),
  ("Content Support Executive", "Handle client content updates and reports.", "Ludhiana", 0, 1, "Part-time", "12k per month", ["Communication", "Excel"])]),
 ("Neha Gupta", "neha@dataly.com", "Dataly Analytics", "Data and AI consultancy.", [
  ("Data Analyst", "Turn business data into clear insights.", "Chandigarh", 1, 3, "Full-time", "5-8 LPA", ["SQL", "Excel", "Pandas", "Data Analysis"]),
  ("Machine Learning Engineer", "Train and deploy ML models.", "Remote", 2, 5, "Full-time", "10-16 LPA", ["Python", "TensorFlow", "Machine Learning", "Pandas"]),
  ("Java Backend Developer", "Maintain enterprise services on AWS.", "Bengaluru", 3, 6, "Full-time", "12-18 LPA", ["Java", "SQL", "REST", "AWS"]),
  ("Business Analyst Intern", "Support reporting and requirement gathering.", "Mohali", 0, 1, "Internship", "10k per month", ["Excel", "SQL", "Communication"])]),
]
JOBS = {}
for name, email, company, about, jobs in RECRUITERS:
    u = user(name, email, "recruiter")
    if not u: continue
    co = Company(name=company, description=about, contact=email); s.add(co); s.flush()
    r = Recruiter(user_id=u.id, company_id=co.id); s.add(r); s.flush()
    for t, d, loc, mn, mx, typ, sal, sk in jobs:
        j = Job(recruiter_id=r.id, title=t, description=d, location=loc, min_exp=mn, max_exp=mx, job_type=typ, salary=sal, status="published")
        s.add(j); s.flush(); link(JobSkill, "job_id", j.id, sk); JOBS[t] = j.id
    if email == "amit@pixelcraft.com":  # one closed job to test statuses
        j = Job(recruiter_id=r.id, title="Legacy PHP Developer", description="Position filled.", location="Pune", min_exp=2, max_exp=4, job_type="Full-time", status="closed")
        s.add(j); s.flush(); link(JobSkill, "job_id", j.id, ["PHP", "MySQL"])

SEEKERS = [
 ("Harpreet Singh", "harpreet@test.com", "9876543210", "B.Tech Computer Science, Punjab Technical University", "2 years", ["Python", "FastAPI", "MySQL", "Git"], ("Backend Developer (Python)", "Shortlisted")),
 ("Simran Kaur", "simran@test.com", "9812345678", "B.Sc IT, Panjab University", "1 years", ["React", "JavaScript", "HTML", "CSS", "Git"], ("Frontend Developer", "Under Review")),
 ("Rahul Mehta", "rahul@test.com", "9988776655", "MCA, Chandigarh University", "4 years", ["Java", "SQL", "AWS", "Linux", "REST"], ("Java Backend Developer", "Interview")),
 ("Anjali Rao", "anjali@test.com", "9123456780", "M.Sc Statistics, Delhi University", "3 years", ["Python", "Pandas", "SQL", "Machine Learning", "Excel"], ("Data Analyst", "Applied")),
 ("Karan Malhotra", "karan@test.com", "9001122334", "BBA, Lovely Professional University", "", ["Communication", "Excel"], None),
]
for name, email, phone, edu, exp, sk, app in SEEKERS:
    u = user(name, email, "candidate")
    if not u: continue
    c = Candidate(user_id=u.id, phone=phone, education=edu, experience=exp, summary=f"{name} is looking for a role that fits their skills.")
    s.add(c); s.flush(); link(CandidateSkill, "candidate_id", c.id, sk)
    text = f"{name}\n{email}\n{phone}\n\nEducation\n{edu}\n\nExperience\n{exp or 'Fresher'}\n\nSkills\n{', '.join(sk)}"
    path = f"uploads/{uuid.uuid4().hex}.pdf"
    doc = fitz.open(); doc.new_page().insert_textbox((50, 50, 550, 780), text, fontsize=12); doc.save(path)
    r = Resume(candidate_id=c.id, filename=f"{name.split()[0]}_Resume.pdf", path=path, file_type="pdf", status="done", text=text,
               parsed=dict(name=name, email=email, phone=phone, education=edu, experience=exp, skills=sk))
    s.add(r); s.flush()
    if app and app[0] in JOBS: s.add(Application(job_id=JOBS[app[0]], candidate_id=c.id, resume_id=r.id, status=app[1]))
s.commit()

# ---- extra applications and spread-out dates, so charts and rankings look real ----
jobs = s.query(Job).filter_by(status="published").all()
statuses = ["Applied", "Under Review", "Shortlisted", "Interview", "Selected", "Rejected"]
for c in s.query(Candidate).all():
    r = s.query(Resume).filter_by(candidate_id=c.id, status="done").first()
    if not r or s.query(Application).filter_by(candidate_id=c.id).count() >= 4: continue
    for j in random.sample(jobs, min(3, len(jobs))):
        if not s.query(Application).filter_by(job_id=j.id, candidate_id=c.id).first():
            s.add(Application(job_id=j.id, candidate_id=c.id, resume_id=r.id, status=random.choice(statuses)))
s.flush()
for u in s.query(User).filter(User.role != "admin"): u.created = datetime.utcnow() - timedelta(days=random.randint(0, 13))
for a in s.query(Application): a.applied = datetime.utcnow() - timedelta(days=random.randint(0, 13))
s.commit()

print("Done. All test accounts use password:", PW)
print("Recruiters: riya@novatech.com, amit@pixelcraft.com, neha@dataly.com")
print("Job seekers: harpreet@test.com, simran@test.com, rahul@test.com, anjali@test.com, karan@test.com")