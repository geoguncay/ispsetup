"""
Script de seed: crea el usuario administrador inicial si no existe.
Se ejecuta al inicio de la aplicación en modo development.
"""
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User

logger = logging.getLogger(__name__)


def seed_admin(db: Session) -> None:
    exists = db.query(User).filter(User.email == settings.ADMIN_SEED_EMAIL).first()
    if exists:
        from app.core.security import verify_password
        if not verify_password(settings.ADMIN_SEED_PASSWORD, exists.hashed_password):
            exists.hashed_password = hash_password(settings.ADMIN_SEED_PASSWORD)
            db.commit()
            logger.info(f"🔑 Contraseña del administrador actualizada según .env")
        else:
            logger.info(f"Usuario admin ya existe: {settings.ADMIN_SEED_EMAIL}")
        return

    admin = User(
        nombre=settings.ADMIN_SEED_NOMBRE,
        email=settings.ADMIN_SEED_EMAIL,
        hashed_password=hash_password(settings.ADMIN_SEED_PASSWORD),
        rol="admin",
        activo=True,
    )
    db.add(admin)
    db.commit()
    logger.info(f"✅ Usuario admin creado: {settings.ADMIN_SEED_EMAIL}")


def run_seed() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
