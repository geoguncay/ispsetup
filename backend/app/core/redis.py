"""
Redis client singleton para la aplicación.
"""
import redis.asyncio as aioredis

from app.core.config import settings

redis_client: aioredis.Redis = aioredis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
)

# ── Claves Redis ──────────────────────────────────────────────────────────────
REFRESH_TOKEN_PREFIX = "refresh_token:"      # refresh_token:{user_id} → token
GATEWAY_HEALTH_PREFIX = "router:health:"      # router:health:{router_id} → JSON
ROUTER_STATUS_TTL = 45                        # segundos
REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7         # 7 días en segundos
