"""
Tarea Celery: health check periódico de todos los balanceadores de carga activos.
"""
import asyncio
import logging

from app.core.database import SessionLocal
from app.models.load_balancer import LoadBalancer
from app.services.load_balancer.health import check_load_balancer_health
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.lb_health.check_all_load_balancers", bind=True, max_retries=0)
def check_all_load_balancers(self):
    """
    Recorre todos los balanceadores activos y actualiza su estado en Redis.
    Se ejecuta cada 30 s vía Celery Beat (igual que check_all_routers).
    """
    db = SessionLocal()
    try:
        load_balancers = db.query(LoadBalancer).filter(LoadBalancer.active == True).all()
        logger.info(f"Health check: revisando {len(load_balancers)} balanceadores activos")

        async def _run_checks():
            tasks = [check_load_balancer_health(lb) for lb in load_balancers]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for lb, result in zip(load_balancers, results):
                if isinstance(result, Exception):
                    logger.error(f"Error en health check de {lb.name}: {result}")
                else:
                    logger.info(f"Balanceador {lb.name}: {result.status}")

        asyncio.run(_run_checks())

    except Exception as exc:
        logger.error(f"Error en check_all_load_balancers: {exc}", exc_info=True)
    finally:
        db.close()
