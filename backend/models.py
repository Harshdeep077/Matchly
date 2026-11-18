from dotenv import load_dotenv
load_dotenv()

import os
from datetime import datetime

from sqlalchemy import (
    create_engine, Column, Integer, String, Text, Boolean, DateTime,
    ForeignKey, JSON
)
from sqlalchemy.orm import declarative_base, sessionmaker

URL = os.getenv("DATABASE_URL", "").strip()

# Railway and some MySQL providers supply mysql:// URLs. This project uses
# PyMySQL, so explicitly select its SQLAlchemy driver when needed.
if URL.startswith("mysql://"):
    URL = URL.replace("mysql://", "mysql+pymysql://", 1)

# Allow the API health check to start before an external database is configured.
# All database-backed endpoints return HTTP 503 until DATABASE_URL is set.
engine = create_engine(URL, pool_pre_ping=True) if URL else None
Session = sessionmaker(bind=engine) if engine is not None else None
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