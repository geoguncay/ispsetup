"""
Tarea Celery: health check periódico de todos los routers activos.
"""
import asyncio
import logging

from app.core.database import SessionLocal
from app.models.router import Router
from app.services.router.health import check_router_health
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.health_check.check_all_routers", bind=True, max_retries=0)
def check_all_routers(self):
    """
    Recorre todos los routers activos y actualiza su estado en Redis.
    Se ejecuta cada 60 s via Celery Beat.
    """
    db = SessionLocal()
    try:
        routers = db.query(Router).filter(Router.active == True).all()
        logger.info(f"Health check: revisando {len(routers)} routers activos")

        async def _run_checks():
            tasks = [check_router_health(g) for g in routers]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for router, result in zip(routers, results):
                if isinstance(result, Exception):
                    logger.error(f"Error en health check de {router.name}: {result}")
                else:
                    logger.info(f"Router {router.name}: {result.status}")

        asyncio.run(_run_checks())

    except Exception as exc:
        logger.error(f"Error en check_all_routers: {exc}", exc_info=True)
    finally:
        db.close()

