"""Adds email OTP verification to Matchly sign-up.
Put this file in the folder that contains 'backend' and 'frontend', then run:  python apply_otp_patch.py
It edits models.py, main.py, App.jsx and index.css in place and keeps a backup of each (.bak_before_otp)."""
import shutil, sys
from pathlib import Path

base = Path(__file__).resolve().parent
P = {"models": base/"backend"/"models.py", "main": base/"backend"/"main.py",
     "app": base/"frontend"/"src"/"App.jsx", "css": base/"frontend"/"src"/"index.css"}
for p in P.values():
    if not p.exists(): sys.exit(f"Cannot find {p}\nPut this file in the folder that contains the 'backend' and 'frontend' folders.")
T = {k: p.read_text(encoding="utf-8") for k, p in P.items()}
if "class PendingSignup" in T["models"]: sys.exit("The OTP patch is already applied. Nothing to do.")

def swap(text, old, new, label):
    if old not in text: sys.exit(f"Could not find the {label} in your file. It was probably changed. Send me that file and I will adjust the patch.")
    return text.replace(old, new, 1)

# ---------------- models.py ----------------
T["models"] = T["models"].rstrip() + r'''


class PendingSignup(Base):
    """A sign-up waiting for its email code. The real account is created only after the code is verified."""
    __tablename__ = "pending_signups"

    id = Column(Integer, **PK)
    email = Column(String(150), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)
    company = Column(String(150))
    code_hash = Column(String(64), nullable=False)
    attempts = Column(Integer, default=0)
    expires = Column(DateTime, nullable=False)
    last_sent = Column(DateTime, nullable=False)
    created = Column(DateTime, default=datetime.utcnow)
'''

# ---------------- main.py ----------------
m = T["main"]
m = swap(m, "import csv, io, os, random, re, secrets, uuid, jwt, bcrypt", "import csv, hashlib, hmac, io, os, random, re, secrets, uuid, jwt, bcrypt", "first import line of main.py")
a = m.index('@app.post("/auth/register", status_code=201)') if '@app.post("/auth/register", status_code=201)' in m else sys.exit("Could not find the register route in main.py.")
b = m.index('@app.post("/auth/login")') if '@app.post("/auth/login")' in m else sys.exit("Could not find the login route in main.py.")
m = m[:a] + r'''# ---------- sign-up with email verification code (OTP) ----------
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

''' + m[b:]
T["main"] = m

# ---------------- App.jsx ----------------
x = T["app"]
a = x.index("  const submit = async e => { e.preventDefault(); setBusy(true);") if "  const submit = async e => { e.preventDefault(); setBusy(true);" in x else sys.exit("Could not find the sign-up submit code in App.jsx.")
b = x.index('  const form = <form className={embedded?"authform":"glass card"} onSubmit={submit}>') if '  const form = <form className={embedded?"authform":"glass card"} onSubmit={submit}>' in x else sys.exit("Could not find the sign-up form in App.jsx.")
x = x[:a] + r'''  const [step,setStep]=useState("form"), [code,setCode]=useState(""), [wait,setWait]=useState(0), [life,setLife]=useState(0);
  useEffect(()=>{ if(step!=="otp") return; const t=setInterval(()=>{ setWait(v=>Math.max(0,v-1)); setLife(v=>Math.max(0,v-1)); },1000); return ()=>clearInterval(t); },[step]);
  const enter = d => { login(d); const nx=sessionStorage.getItem("next"); sessionStorage.removeItem("next"); nav(nx&&d.role==="candidate"?nx:home(d.role)); };
  const sentNote = r => ok(r.delivery==="terminal" ? "Email sending is not set up yet, so the code was printed in the backend terminal." : r.message);
  const submit = async e => { e.preventDefault(); setBusy(true);
    try {
      if (reg) { const r=await call("/auth/register",{method:"POST",body:f}); setStep("otp"); setCode(""); setWait(60); setLife(r.minutes*60); sentNote(r); }
      else enter(await call("/auth/login",{method:"POST",body:{email:f.email,password:f.password,role:space}}));
    } catch(x){ err(x); } setBusy(false); };
  const verify = async e => { e.preventDefault(); setBusy(true);
    try { enter(await call("/auth/verify",{method:"POST",body:{email:f.email,code}})); } catch(x){ err(x); } setBusy(false); };
  const resend = async () => { setBusy(true);
    try { const r=await call("/auth/resend",{method:"POST",body:{email:f.email}}); setCode(""); setWait(60); setLife(r.minutes*60); sentNote(r); } catch(x){ err(x); } setBusy(false); };
  const mm=String(Math.floor(life/60)).padStart(2,"0")+":"+String(life%60).padStart(2,"0");
  const otp = <form className={embedded?"authform":"glass card"} onSubmit={verify}>
    <Note n={n}/><p className="muted" style={{margin:"4px 0 10px"}}>Enter the 6-digit code sent to <b>{f.email}</b>.</p>
    <label htmlFor="otp">Verification code</label>
    <input id="otp" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} placeholder="000000"/>
    <p className="muted" style={{fontSize:".85rem",margin:"8px 0 0"}}>{life>0?`Code expires in ${mm}`:"This code has expired. Request a new one."}</p>
    <button className={space?"small":""} style={space?{margin:"14px auto 0",display:"block"}:{marginTop:14,width:"100%"}} disabled={busy||code.length!==6||life===0}>{busy?"Checking...":"Verify and continue"}</button>
    <p className="muted switch"><button type="button" className="linkbtn" disabled={busy||wait>0} onClick={resend}>{wait>0?`Resend code in ${wait}s`:"Resend code"}</button> · <button type="button" className="linkbtn" onClick={()=>{ setStep("form"); setCode(""); }}>Change email</button></p></form>;
''' + x[b:]
x = swap(x, 'return embedded ? form : <div className="wrap" style={{maxWidth:440}}>{form}</div>;',
         'const view = step==="otp" ? otp : form;\n  return embedded ? view : <div className="wrap" style={{maxWidth:440}}>{view}</div>;', "end of the Auth component in App.jsx")
T["app"] = x

# ---------------- index.css ----------------
T["css"] = T["css"].rstrip() + r'''

/* ---- email verification code ---- */
.otp{font:700 1.6rem "Bricolage Grotesque",sans-serif;letter-spacing:.5em;text-align:center}
.linkbtn{background:none;color:var(--accent);padding:0;border-radius:0;font-weight:600}
.linkbtn:hover:not(:disabled){filter:none;text-decoration:underline}
.linkbtn:disabled{color:var(--mute);cursor:default;opacity:1}
'''

for k, p in P.items():
    shutil.copy(p, p.with_name(p.name + ".bak_before_otp"))
    p.write_text(T[k], encoding="utf-8")
print("Done. OTP verification added. Backups saved as *.bak_before_otp next to each file.")
print("Next: add the SMTP lines to backend/.env, then restart the backend (the new pending_signups table is created automatically).")
