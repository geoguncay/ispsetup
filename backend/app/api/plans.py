"""
Endpoints CRUD de Planes de ancho de banda (velocidades y precios).
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.deps import AdminOnly, CurrentUser, DBSession
from app.models.plan import Plan
from app.models.client_plan import ClientPlan
from app.schemas.plan import PlanCreate, PlanResponse, PlanUpdate

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("", response_model=list[PlanResponse])
def list_plans(db: DBSession, _: CurrentUser) -> list[Plan]:
    """Lista todos los planes de ancho de banda."""
    return db.query(Plan).order_by(Plan.price.asc()).all()


@router.post("", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanCreate, db: DBSession, _: AdminOnly) -> Plan:
    """Crea un nuevo plan (Solo Administradores)."""
    p = Plan(
        name=payload.name,
        speed_down_kbps=payload.speed_down_kbps,
        speed_up_kbps=payload.speed_up_kbps,
        speed_down_mbps=payload.speed_down_kbps // 1000,
        speed_up_mbps=payload.speed_up_kbps // 1000,
        price=payload.price,
        description=payload.description,
        taxes=payload.taxes,
        limit_at_up_kbps=payload.limit_at_up_kbps,
        limit_at_down_kbps=payload.limit_at_down_kbps,
        burst_threshold_up_kbps=payload.burst_threshold_up_kbps,
        burst_threshold_down_kbps=payload.burst_threshold_down_kbps,
        priority=payload.priority,
        address_list=payload.address_list,
        parent=payload.parent,
    )
    db.add(p)
    try:
        db.commit()
        db.refresh(p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un plan con el nombre: {payload.name}",
        )
    return p


@router.get("/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: uuid.UUID, db: DBSession, _: CurrentUser) -> Plan:
    """Obtiene el detalle de un plan."""
    p = db.get(Plan, plan_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")
    return p


@router.put("/{plan_id}", response_model=PlanResponse)
def update_plan(
    plan_id: uuid.UUID, payload: PlanUpdate, db: DBSession, _: AdminOnly
) -> Plan:
    """Edita un plan existente (Solo Administradores)."""
    p = db.get(Plan, plan_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    if "speed_down_kbps" in update_data:
        p.speed_down_mbps = update_data["speed_down_kbps"] // 1000
    if "speed_up_kbps" in update_data:
        p.speed_up_mbps = update_data["speed_up_kbps"] // 1000
    for field, value in update_data.items():
        setattr(p, field, value)

    try:
        db.commit()
        db.refresh(p)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un plan con el nombre: {payload.name}",
        )

    # Propagar los cambios de velocidad y nombre del plan en cascada a MikroTik
    active_client_plans = (
        db.query(ClientPlan)
        .filter(ClientPlan.plan_id == plan_id, ClientPlan.estado == "activo")
        .all()
    )

    for cp in active_client_plans:
        client = cp.client
        if client and client.active and client.connection_type == "static" and client.static_ip and client.gateway:
            try:
                from app.services.mikrotik.address_list import sync_ip_in_address_list, get_clean_list_name
                from app.services.mikrotik.queue import sync_client_queue, get_clean_parent_name

                addr_list_name = get_clean_list_name(client.gateway.address_list or p.address_list)

                # Sincronizar address-list
                sync_ip_in_address_list(
                    client.gateway,
                    client.static_ip.ip,
                    client.name,
                    list_name=addr_list_name
                )

                # Sincronizar cola en MikroTik con los datos actualizados del plan
                sync_client_queue(
                    gateway=client.gateway,
                    client_name=client.name,
                    ip=client.static_ip.ip,
                    speed_up=p.speed_up_kbps,
                    speed_down=p.speed_down_kbps,
                    plan_name=p.name,
                    limit_at_up=p.limit_at_up_kbps,
                    limit_at_down=p.limit_at_down_kbps,
                    burst_threshold_up=p.burst_threshold_up_kbps,
                    burst_threshold_down=p.burst_threshold_down_kbps,
                    priority=p.priority,
                    parent=get_clean_parent_name(client.gateway.parent_queue or p.parent),
                )
            except Exception as e:
                # Registrar error, pero no cancelar la actualización del plan comercial general
                import logging
                logging.getLogger(__name__).error(
                    f"Fallo al sincronizar en cascada en MikroTik para cliente {client.id} tras actualizar plan {p.name}: {e}"
                )

    return p


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: uuid.UUID, db: DBSession, _: AdminOnly) -> None:
    """Elimina un plan si no está en uso por ningún cliente activo (Solo Administradores)."""
    p = db.get(Plan, plan_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")

    # Validar si el plan está en uso por algún cliente con estado 'activo' o 'suspendido'
    in_use = db.query(ClientPlan).filter(
        ClientPlan.plan_id == plan_id,
        ClientPlan.estado.in_(["activo", "suspendido"])
    ).first()

    if in_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede eliminar el plan porque está asignado a clientes activos o suspendidos.",
        )

    db.delete(p)
    db.commit()
