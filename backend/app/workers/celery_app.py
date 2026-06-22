"""
Celery application y tareas programadas (Beat).
"""
from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "isp_platform",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.workers.health_check",
        "app.workers.suspension",
        "app.workers.traffic",
        "app.workers.billing"
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Guayaquil",
    enable_utc=True,
    task_track_started=True,
    worker_redirect_stdouts_level="INFO",
    beat_schedule={
        # Health check de todos los routers cada 60 segundos
        "check-all-routers-health": {
            "task": "app.workers.health_check.check_all_routers",
            "schedule": 60.0,  # segundos
        },
        # Verificación diaria de suspensiones a la 1:00 AM
        "daily-suspension-check": {
            "task": "app.workers.suspension.daily_suspension_check",
            "schedule": crontab(hour=1, minute=0),
        },
        # Monitoreo de tráfico cada 5 segundos
        "poll-traffic-5s": {
            "task": "app.workers.traffic.poll_traffic",
            "schedule": 5.0,  # segundos
        },
        # Generación de facturas el 1 de cada mes a las 00:00
        "generate-monthly-invoices": {
            "task": "app.workers.billing.generate_monthly_invoices",
            "schedule": crontab(day_of_month=1, hour=0, minute=0),
        },
        # Verificación diaria de facturas vencidas a las 2:00 AM
        "check-overdue-invoices": {
            "task": "app.workers.billing.check_overdue_invoices",
            "schedule": crontab(hour=2, minute=0),
        },
    },
)
