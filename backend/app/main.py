"""
Punto de entrada principal de FastAPI.
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


from app.api import auth, routers_api, users, company, clients, plans, traffic_api, custom_services, sites_api, invoices, payments
from app.core.config import settings
from app.core.database import Base, engine, run_migrations
from app.core.seed import run_seed

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Lifespan (reemplaza on_event, compatible con FastAPI 0.93+) ───────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    logger.info(f"🚀 {settings.APP_NAME} iniciando en modo {settings.ENVIRONMENT}")

    # Crear tablas solo en dev; en prod usar: alembic upgrade head
    if settings.ENVIRONMENT == "development":
        Base.metadata.create_all(bind=engine)
        run_migrations(engine)
        run_seed()

    yield  # La app corre aquí

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info(f"🛑 {settings.APP_NAME} detenido")


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Plataforma de gestión centralizada para WISP — MikroTik, PPPoE, facturación SRI",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# Ensure upload directory exists
os.makedirs("static/uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(routers_api.router, prefix="/api")
app.include_router(company.router, prefix="/api")
app.include_router(clients.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(traffic_api.router, prefix="/api")
app.include_router(custom_services.router, prefix="/api")
app.include_router(sites_api.router, prefix="/api")
app.include_router(invoices.router, prefix="/api")
app.include_router(payments.router, prefix="/api")



@app.get("/api/health", tags=["health"])
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.ENVIRONMENT}
