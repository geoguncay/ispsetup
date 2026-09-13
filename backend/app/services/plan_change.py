"""
Aplicación efectiva de un cambio de plan para un cliente: cancela el/los
ClientPlan activos, sincroniza la velocidad en MikroTik (estático o PPPoE) y
crea el nuevo ClientPlan activo.

Se usa tanto desde `POST /clients/{id}/assign-plan` (cambio inmediato) como
desde la tarea `generate_monthly_invoices` (cambio diferido al iniciar el
nuevo periodo). Hace su propio commit al finalizar con éxito, de forma que
un fallo al aplicar el cambio de un cliente en un lote no arrastre ni
revierta los cambios ya confirmados de otros clientes procesados antes.
"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.security import decrypt_secret
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.plan import Plan
from app.models.pppoe_profile import PPPoEProfile
from app.services.router.address_list import sync_ip_in_address_list, get_clean_list_name
from app.services.router.queue import sync_client_queue, get_clean_parent_name


def apply_plan_change(db: Session, client: Client, new_plan: Plan, commit: bool = True) -> ClientPlan:
    """
    Aplica el cambio de plan de `client` a `new_plan` ahora mismo. Lanza la
    excepción original si falla la sincronización con MikroTik (nada queda
    comprometido en la base de datos en ese caso, ya que el commit es lo
    último que se ejecuta).

    `commit=False` deja los cambios solo en la sesión (sin confirmar) para
    que el llamador los englobe en su propia transacción — usado por el lote
    de facturación mensual, donde cada cliente se aplica dentro de su propio
    SAVEPOINT para no arrastrar ni revertir el trabajo ya hecho por otros
    clientes procesados antes en la misma corrida.
    """
    now = datetime.now(timezone.utc)

    active_plans = (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
        .all()
    )
    for ap in active_plans:
        ap.estado = "cancelado"
        ap.fecha_fin = now

    if client.access_method == "static" and client.static_ip:
        addr_list_name = get_clean_list_name(client.router.address_list or new_plan.address_list)
        sync_ip_in_address_list(client.router, client.static_ip.ip, client.full_name, list_name=addr_list_name)
        sync_client_queue(
            router=client.router,
            client_name=client.full_name,
            ip=client.static_ip.ip,
            speed_up=new_plan.speed_up_kbps,
            speed_down=new_plan.speed_down_kbps,
            plan_name=new_plan.name,
            limit_at_up=new_plan.limit_at_up_kbps,
            limit_at_down=new_plan.limit_at_down_kbps,
            burst_threshold_up=new_plan.burst_threshold_up_kbps,
            burst_threshold_down=new_plan.burst_threshold_down_kbps,
            priority=new_plan.priority,
            parent=get_clean_parent_name(client.router.parent_queue or new_plan.parent),
        )
    elif client.access_method == "pppoe" and client.pppoe_secret:
        from app.services.router.pppoe import sync_pppoe_profile_in_router, sync_pppoe_secret_in_router

        profile = db.query(PPPoEProfile).filter(
            PPPoEProfile.router_id == client.router_id,
            PPPoEProfile.name == new_plan.name
        ).first()
        if not profile:
            profile = PPPoEProfile(
                name=new_plan.name,
                speed_down_mbps=new_plan.speed_down_mbps,
                speed_up_mbps=new_plan.speed_up_mbps,
                router_id=client.router_id
            )
            db.add(profile)
            db.flush()

        sync_pppoe_profile_in_router(client.router, new_plan)
        client.pppoe_secret.profile_id = profile.id

        password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
        sync_pppoe_secret_in_router(
            router=client.router,
            username=client.pppoe_secret.ppp_username,
            password=password_dec,
            profile_name=profile.name,
            client_name=client.full_name,
            disabled=not client.active
        )

    new_client_plan = ClientPlan(
        cliente_id=client.id,
        plan_id=new_plan.id,
        fecha_inicio=now,
        estado="activo",
    )
    db.add(new_client_plan)
    if commit:
        db.commit()
        db.refresh(new_client_plan)
    else:
        db.flush()
    return new_client_plan
