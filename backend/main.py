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
    s = Session()
    try:
        # Create the first admin only when secure credentials are explicitly set
        # in the hosting environment. Never deploy a public default password.
        admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        admin_password = os.getenv("ADMIN_PASSWORD", "")
        if admin_email and admin_password and not s.query(User).filter_by(role="admin").first():
            s.add(User(
                name=os.getenv("ADMIN_NAME", "Matchly Admin"),
                email=admin_email,
                role="admin",
                password_hash=hp(admin_password),
            ))
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