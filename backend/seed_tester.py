"""Creates a fresh job seeker with Python skills and no applications, so you can test the shortlist, test and next-round flow.
Usage:  python seed_tester.py                  (email: tester@test.com)
        python seed_tester.py you@gmail.com    (use your own email to receive the test link)"""
import os, sys, uuid, bcrypt, fitz
from models import *

Base.metadata.create_all(engine); os.makedirs("uploads", exist_ok=True)
s = Session(); email = (sys.argv[1] if len(sys.argv) > 1 else "tester@test.com").lower(); name = "Test Candidate"
if s.query(User).filter_by(email=email).first():
    print(f"{email} already exists. Log in with Test@1234, or run this again with a different email."); sys.exit()
u = User(name=name, email=email, role="candidate", password_hash=bcrypt.hashpw(b"Test@1234", bcrypt.gensalt()).decode()); s.add(u); s.flush()
skills = ["Python", "FastAPI", "MySQL", "Docker", "Git"]
c = Candidate(user_id=u.id, phone="9000000000", education="B.Tech Computer Science", experience="2 years", summary="Python developer.")
s.add(c); s.flush()
for n in skills:
    sk = s.query(Skill).filter_by(name=n).first() or Skill(name=n); s.add(sk); s.flush(); s.add(CandidateSkill(candidate_id=c.id, skill_id=sk.id))
text = f"{name}\n{email}\n9000000000\n\nEducation\nB.Tech Computer Science\n\nExperience\n2 years\n\nSkills\n{', '.join(skills)}"
path = f"uploads/{uuid.uuid4().hex}.pdf"; doc = fitz.open(); doc.new_page().insert_textbox((50, 50, 550, 780), text, fontsize=12); doc.save(path)
s.add(Resume(candidate_id=c.id, filename="Test_Resume.pdf", path=path, file_type="pdf", status="done", text=text,
             parsed=dict(name=name, email=email, phone="9000000000", education="B.Tech Computer Science", experience="2 years", skills=skills)))
s.commit(); print(f"Done. Log in as {email} / Test@1234 and apply to 'Backend Developer (Python)'.")