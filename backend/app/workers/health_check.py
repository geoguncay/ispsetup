"""
Tarea Celery: health check periódico de todos los gateways activos.
"""
import asyncio
import logging

from app.core.database import SessionLocal
from app.models.gateway import Gateway
from app.services.mikrotik.health import check_gateway_health
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.health_check.check_all_gateways", bind=True, max_retries=0)
def check_all_gateways(self):
    """
    Recorre todos los gateways activos y actualiza su estado en Redis.
    Se ejecuta cada 60 s via Celery Beat.
    """
    db = SessionLocal()
    try:
        gateways = db.query(Gateway).filter(Gateway.active == True).all()
        logger.info(f"Health check: revisando {len(gateways)} gateways activos")

        async def _run_checks():
            tasks = [check_gateway_health(g) for g in gateways]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for gateway, result in zip(gateways, results):
                if isinstance(result, Exception):
                    logger.error(f"Error en health check de {gateway.name}: {result}")
                else:
                    logger.info(f"Gateway {gateway.name}: {result.status}")

        asyncio.run(_run_checks())

    except Exception as exc:
        logger.error(f"Error en check_all_gateways: {exc}", exc_info=True)
    finally:
        db.close()

