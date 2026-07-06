"""
API de logs de auditoría del sistema ISP.
"""
from datetime import datetime

from fastapi import APIRouter, Query
from sqlalchemy import desc

from app.core.deps import AdminOnly, DBSession
from app.models.audit_log import AuditLog
from app.schemas.audit_log import AuditLogListResponse, AuditLogRead

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


@router.get("", response_model=AuditLogListResponse)
def list_audit_logs(
    db: DBSession,
    _: AdminOnly,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    action: str | None = Query(None, description="Filtrar por tipo de acción"),
    entity_type: str | None = Query(None, description="Filtrar por tipo de entidad"),
    entity_id: str | None = Query(None, description="Filtrar por ID de entidad"),
    user_id: str | None = Query(None, description="Filtrar por usuario"),
    date_from: datetime | None = Query(None, description="Desde fecha (ISO 8601)"),
    date_to: datetime | None = Query(None, description="Hasta fecha (ISO 8601)"),
) -> AuditLogListResponse:
    """
    Lista los eventos de auditoría con filtros opcionales. Solo accesible por admins.
    """
    q = db.query(AuditLog)

    if action:
        q = q.filter(AuditLog.action == action)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(AuditLog.entity_id == entity_id)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)
    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at <= date_to)

    total = q.count()
    items = q.order_by(desc(AuditLog.created_at)).offset(skip).limit(limit).all()

    return AuditLogListResponse(
        items=[AuditLogRead.model_validate(item) for item in items],
        total=total,
    )
