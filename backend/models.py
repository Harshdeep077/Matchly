from dotenv import load_dotenv
load_dotenv()

import os
from datetime import datetime

from sqlalchemy import (
    create_engine, Column, Integer, String, Text, Boolean, DateTime,
    ForeignKey, JSON
)
from sqlalchemy.orm import declarative_base, sessionmaker

URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://root:password@localhost:3306/skillsphere"
)

engine = create_engine(URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine)
Base = declarative_base()
PK = dict(primary_key=True)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, **PK)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False)
    active = Column(Boolean, default=True)
    created = Column(DateTime, default=datetime.utcnow)


class Company(Base):
    __tablename__ = "companies"
    id = Column(Integer, **PK)
    name = Column(String(150), nullable=False)
    description = Column(Text)
    contact = Column(String(150))


class Recruiter(Base):
    __tablename__ = "recruiters"
    id = Column(Integer, **PK)
    user_id = Column(ForeignKey("users.id"), unique=True)
    company_id = Column(ForeignKey("companies.id"))


class Candidate(Base):
    __tablename__ = "candidates"
    id = Column(Integer, **PK)
    user_id = Column(ForeignKey("users.id"), unique=True)
    phone = Column(String(30))
    education = Column(Text)
    experience = Column(Text)
    summary = Column(Text)


class Skill(Base):
    __tablename__ = "skills"
    id = Column(Integer, **PK)
    name = Column(String(80), unique=True, nullable=False)


class CandidateSkill(Base):
    __tablename__ = "candidate_skills"
    candidate_id = Column(ForeignKey("candidates.id"), primary_key=True)
    skill_id = Column(ForeignKey("skills.id"), primary_key=True)


class Job(Base):
    __tablename__ = "jobs"
    id = Column(Integer, **PK)
    recruiter_id = Column(ForeignKey("recruiters.id"), nullable=False)
    title = Column(String(150), nullable=False)
    description = Column(Text)
    location = Column(String(100))
    min_exp = Column(Integer, default=0)
    max_exp = Column(Integer, default=0)
    job_type = Column(String(30))
    salary = Column(String(60))
    status = Column(String(20), default="published")
    created = Column(DateTime, default=datetime.utcnow)


class JobSkill(Base):
    __tablename__ = "job_skills"
    job_id = Column(ForeignKey("jobs.id"), primary_key=True)
    skill_id = Column(ForeignKey("skills.id"), primary_key=True)


class Resume(Base):
    __tablename__ = "resumes"
    id = Column(Integer, **PK)
    candidate_id = Column(ForeignKey("candidates.id"), nullable=False)
    filename = Column(String(200))
    path = Column(String(300))
    file_type = Column(String(10))
    uploaded = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20))
    error = Column(String(255))
    text = Column(Text)
    parsed = Column(JSON)


class Application(Base):
    __tablename__ = "applications"
    id = Column(Integer, **PK)
    job_id = Column(ForeignKey("jobs.id"), nullable=False)
    candidate_id = Column(ForeignKey("candidates.id"), nullable=False)
    resume_id = Column(ForeignKey("resumes.id"), nullable=False)
    applied = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20), default="Applied")


class ResumeAnalysis(Base):
    __tablename__ = "resume_analysis"
    id = Column(Integer, **PK)
    resume_id = Column(ForeignKey("resumes.id"))
    job_id = Column(ForeignKey("jobs.id"))
    score = Column(Integer)
    matched = Column(JSON)
    missing = Column(JSON)
    created = Column(DateTime, default=datetime.utcnow)


class SavedJob(Base):
    __tablename__ = "saved_jobs"
    candidate_id = Column(ForeignKey("candidates.id"), primary_key=True)
    job_id = Column(ForeignKey("jobs.id"), primary_key=True)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, **PK)
    user_id = Column(ForeignKey("users.id"), nullable=False)
    message = Column(String(255))
    read = Column(Boolean, default=False)
    created = Column(DateTime, default=datetime.utcnow)


class Question(Base):
    __tablename__ = "questions"
    id = Column(Integer, **PK)
    job_id = Column(ForeignKey("jobs.id"), nullable=True, index=True)
    company_id = Column(ForeignKey("companies.id"), nullable=True)
    tech = Column(String(60), nullable=False, index=True)
    text = Column(Text, nullable=False)
    a = Column(Text)
    b = Column(Text)
    c = Column(Text)
    d = Column(Text)
    answer = Column(String(1), nullable=False)


class Test(Base):
    __tablename__ = "tests"
    id = Column(Integer, **PK)
    # Multiple test attempts are allowed for one application.
    application_id = Column(ForeignKey("applications.id"), nullable=False, index=True)
    token = Column(String(64), unique=True, nullable=False)
    tech = Column(String(200))
    question_ids = Column(JSON)
    answers = Column(JSON)
    score = Column(Integer)
    total = Column(Integer)
    status = Column(String(20), default="pending")
    created = Column(DateTime, default=datetime.utcnow)
    expires = Column(DateTime)
    started = Column(DateTime)
    completed = Column(DateTime)


class PendingSignup(Base):
    """A sign-up waiting for its email code."""
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


# ==================== ONLINE EXAM PROCTORING ====================

class ProctoringSession(Base):
    __tablename__ = "proctoring_sessions"
    id = Column(Integer, **PK)
    test_id = Column(ForeignKey("tests.id"), nullable=False, index=True)
    candidate_id = Column(ForeignKey("candidates.id"), nullable=False, index=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    status = Column(String(20), default="active")
    # active, completed, interrupted, flagged


class ProctoringEvent(Base):
    __tablename__ = "proctoring_events"
    id = Column(Integer, **PK)
    session_id = Column(ForeignKey("proctoring_sessions.id"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)
    # tab_switch, fullscreen_exit, face_not_detected,
    # multiple_faces, camera_disabled, phone_detected
    description = Column(Text)
    evidence_path = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TestRecording(Base):
    __tablename__ = "test_recordings"
    id = Column(Integer, **PK)
    test_id = Column(ForeignKey("tests.id"), nullable=False, unique=True, index=True)
    application_id = Column(ForeignKey("applications.id"), nullable=False, index=True)
    candidate_id = Column(ForeignKey("candidates.id"), nullable=False, index=True)
    recruiter_id = Column(ForeignKey("recruiters.id"), nullable=False, index=True)
    cloudinary_public_id = Column(String(255), nullable=False, unique=True)
    resource_type = Column(String(30), default="video")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)


class VideoAssessmentAction(Base):
    __tablename__ = "video_assessment_actions"
    id = Column(Integer, **PK)
    application_id = Column(ForeignKey("applications.id"), nullable=False, index=True)
    recruiter_id = Column(ForeignKey("recruiters.id"), nullable=False, index=True)
    kind = Column(String(30), nullable=False)  # video_assignment or meeting
    title = Column(String(180), nullable=False)
    instructions = Column(Text)
    due_at = Column(DateTime)
    meeting_at = Column(DateTime)
    meeting_url = Column(String(500))
    status = Column(String(30), default="scheduled")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class LiveInterviewRoom(Base):
    """Private LiveKit room mapping for a scheduled Matchly interview."""
    __tablename__ = "live_interview_rooms"
    id = Column(Integer, **PK)
    action_id = Column(ForeignKey("video_assessment_actions.id"), nullable=False, unique=True, index=True)
    room_name = Column(String(80), nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
