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
from app.models.plan import Plan

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
        name=settings.ADMIN_SEED_NAME,
        email=settings.ADMIN_SEED_EMAIL,
        hashed_password=hash_password(settings.ADMIN_SEED_PASSWORD),
        role="admin",
        active=True,
    )
    db.add(admin)
    db.commit()
    logger.info(f"✅ Usuario admin creado: {settings.ADMIN_SEED_EMAIL}")


def seed_plans(db: Session) -> None:
    default_plans = [
        {"name": "Plan Básico 20 Mbps", "speed_down_mbps": 20, "speed_up_mbps": 10, "speed_down_kbps": 20000, "speed_up_kbps": 10000, "price": 15.00, "description": "Plan de internet básico de 20 Mbps", "taxes": 15.0, "priority": 8, "address_list": "clientes"},
        {"name": "Plan Familiar 50 Mbps", "speed_down_mbps": 50, "speed_up_mbps": 25, "speed_down_kbps": 50000, "speed_up_kbps": 25000, "price": 25.00, "description": "Plan familiar ideal de 50 Mbps", "taxes": 15.0, "priority": 6, "address_list": "clientes"},
        {"name": "Plan Corporativo 100 Mbps", "speed_down_mbps": 100, "speed_up_mbps": 50, "speed_down_kbps": 100000, "speed_up_kbps": 50000, "price": 45.00, "description": "Plan corporativo de alta velocidad", "taxes": 15.0, "priority": 3, "address_list": "clientes"},
    ]
    for dp in default_plans:
        exists = db.query(Plan).filter(Plan.name == dp["name"]).first()
        if not exists:
            plan = Plan(
                name=dp["name"],
                speed_down_mbps=dp["speed_down_mbps"],
                speed_up_mbps=dp["speed_up_mbps"],
                speed_down_kbps=dp["speed_down_kbps"],
                speed_up_kbps=dp["speed_up_kbps"],
                price=dp["price"],
                description=dp["description"],
                taxes=dp["taxes"],
                priority=dp["priority"],
                address_list=dp["address_list"],
            )
            db.add(plan)
            logger.info(f"✅ Plan de ancho de banda creado: {dp['name']}")
    db.commit()


def run_seed() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
        seed_plans(db)
    finally:
        db.close()
