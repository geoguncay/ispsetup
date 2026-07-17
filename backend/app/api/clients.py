"""
Endpoints CRUD de Clientes, historial de planes y asignación de planes.
"""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import AdminOrTechnician, CurrentUser, DBSession
from app.models.client import Client
from app.models.plan import Plan
from app.models.gateway import Gateway
from app.models.client_plan import ClientPlan
from app.models.static_ip import StaticIP
from app.models.payment import ClientPayment
from app.models.ticket import ClientTicket
from app.models.suspension_log import SuspensionLog
from app.models.pppoe_secret import PPPoESecret
from app.models.pppoe_profile import PPPoEProfile
from app.models.invoice import Invoice
from app.models.custom_service import CustomService
from app.models.inventory import InventoryItem
from app.models.client_inventory import ClientInventoryItem
from app.services.mikrotik.pppoe import (
    sync_pppoe_secret_in_gateway,
    remove_pppoe_secret_from_gateway,
    disconnect_pppoe_session,
)
from app.core.security import encrypt_secret, decrypt_secret
from app.services.mikrotik.address_list import (
    sync_ip_in_address_list,
    remove_ip_from_address_list,
    suspend_ip_in_firewall,
    unsuspend_ip_in_firewall,
    get_clean_list_name,
)
from app.services.mikrotik.queue import (
    sync_client_queue,
    remove_client_queue,
    toggle_client_queue,
    get_clean_parent_name,
)
from app.services.notifications.twilio_service import send_suspension_notification
from app.schemas.client import (
    ClientCreate,
    ClientListResponse,
    ClientPlanResponse,
    ClientResponse,
    ClientUpdate,
    SuspensionLogResponse,
)
from app.schemas.payment import PaymentResponse
from app.schemas.ticket import TicketCreate, TicketResponse
from app.schemas.traffic import TrafficResponse
from app.schemas.invoice import InvoiceResponse
from app.services.audit_service import AuditAction, log_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clients", tags=["clients"])


def _is_in_the_past(dt: datetime) -> bool:
    """
    Compara una fecha con el momento actual de forma segura frente a zonas horarias:
    el navegador del usuario envía la fecha ya convertida a UTC (con offset), mientras
    que el reloj del servidor puede estar en cualquier zona horaria local. Normalizamos
    ambos lados a UTC antes de comparar para evitar falsos "la fecha ya pasó".
    """
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc) <= datetime.now(timezone.utc)
    return dt <= datetime.now()


def _enrich_client(client: Client, db: Session) -> dict:
    """Enriquece el modelo Client con información de su plan activo, el router y la IP estática."""
    data = ClientResponse.model_validate(client).model_dump()

    # Buscar plan activo (estado == 'activo')
    active_client_plan = (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
        .first()
    )

    if active_client_plan and active_client_plan.plan:
        data["plan_activo"] = active_client_plan.plan
    else:
        data["plan_activo"] = None

    if client.gateway:
        data["gateway_name"] = client.gateway.name
        data["site_id"] = client.gateway.site_id
        data["site_name"] = client.gateway.site_name
    else:
        data["gateway_name"] = None
        data["site_id"] = None
        data["site_name"] = None

    # Static IP
    if client.static_ip:
        data["static_ip"] = client.static_ip
    else:
        data["static_ip"] = None

    # PPPoE Secret
    if client.pppoe_secret:
        try:
            decrypted_password = decrypt_secret(client.pppoe_secret.ppp_password)
        except Exception:
            decrypted_password = "[Error al descifrar]"

        data["pppoe_secret"] = {
            "id": client.pppoe_secret.id,
            "client_id": client.pppoe_secret.client_id,
            "gateway_id": client.pppoe_secret.gateway_id,
            "ppp_username": client.pppoe_secret.ppp_username,
            "profile_id": client.pppoe_secret.profile_id,
            "ppp_password": decrypted_password,
            "created_at": client.pppoe_secret.created_at,
            "updated_at": client.pppoe_secret.updated_at,
        }
    else:
        data["pppoe_secret"] = None

    # Equipos de inventario asignados
    inventory_items = []
    for assignment in client.inventory_items:
        item = assignment.inventory_item
        inventory_items.append({
            "id": assignment.id,
            "inventory_item_id": assignment.inventory_item_id,
            "quantity": assignment.quantity,
            "serial_number": assignment.serial_number,
            "mac": assignment.mac,
            "notes": assignment.notes,
            "assigned_at": assignment.assigned_at,
            "item_name": item.name if item else None,
            "item_code": item.code if item else None,
            "item_model": item.model if item else None,
            "item_category": item.category if item else None,
        })
    data["inventory_items"] = inventory_items

    return data


@router.get("", response_model=ClientListResponse)
def list_clients(
    db: DBSession,
    _: AdminOrTechnician,
    gateway_id: uuid.UUID | None = None,
    plan_id: uuid.UUID | None = None,
    site_id: uuid.UUID | None = None,
    active: bool | None = None,
    connection_type: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "desc",
    skip: int = 0,
    limit: int = 10,
) -> ClientListResponse:
    """
    Lista clientes con filtros dinámicos (router, plan, estado, tipo de conexión, búsqueda por texto, sitio)
    y paginación.
    """
    query = db.query(Client)

    if gateway_id:
        query = query.filter(Client.gateway_id == gateway_id)

    if site_id:
        query = query.join(Gateway, Client.gateway_id == Gateway.id).filter(Gateway.site_id == site_id)

    if active is not None:
        query = query.filter(Client.active == active)

    if connection_type:
        query = query.filter(Client.connection_type == connection_type)

    if plan_id:
        # Filtrar clientes cuyo plan activo sea el plan_id dado
        query = query.join(ClientPlan, Client.id == ClientPlan.cliente_id).filter(
            ClientPlan.plan_id == plan_id, ClientPlan.estado == "activo"
        )

    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (Client.name.ilike(search_filter))
            | (Client.cedula.ilike(search_filter))
            | (Client.phone.ilike(search_filter))
        )

    # Ordenamiento dinámico
    sort_column = Client.created_at
    if sort_by == "last_name":
        sort_column = Client.last_name
    elif sort_by == "first_name":
        sort_column = Client.first_name
    elif sort_by == "name":
        sort_column = Client.name
    elif sort_by == "cedula":
        sort_column = Client.cedula
    elif sort_by == "email":
        sort_column = Client.email
    elif sort_by == "created_at":
        sort_column = Client.created_at
    elif sort_by == "connection_type":
        sort_column = Client.connection_type
    elif sort_by == "active":
        from sqlalchemy import case
        sort_column = case(
            (Client.active == False, case(
                (Client.scheduled_reactivation.isnot(None), 3),
                else_=4,
            )),
            (Client.scheduled_suspension.isnot(None), 2),
            else_=1,
        )
    elif sort_by == "ip":
        from sqlalchemy.orm import aliased
        static_ip_alias = aliased(StaticIP)
        query = query.outerjoin(static_ip_alias, Client.id == static_ip_alias.client_id)
        sort_column = static_ip_alias.ip
    elif sort_by == "gateway":
        from sqlalchemy.orm import aliased
        gateway_alias = aliased(Gateway)
        query = query.outerjoin(gateway_alias, Client.gateway_id == gateway_alias.id)
        sort_column = gateway_alias.name
    elif sort_by == "plan":
        from sqlalchemy.orm import aliased
        client_plan_alias = aliased(ClientPlan)
        plan_alias = aliased(Plan)
        query = query.outerjoin(
            client_plan_alias,
            (Client.id == client_plan_alias.cliente_id) & (client_plan_alias.estado == "activo")
        ).outerjoin(plan_alias, client_plan_alias.plan_id == plan_alias.id)
        sort_column = plan_alias.name

    if sort_dir == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    total = query.count()
    items = query.offset(skip).limit(limit).all()

    enriched_items = [_enrich_client(item, db) for item in items]
    return ClientListResponse(items=enriched_items, total=total)


@router.post("", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(payload: ClientCreate, db: DBSession, current_user: AdminOrTechnician) -> dict:
    """Crea un nuevo cliente. Opcionalmente asigna un plan inicial y sincroniza IP estática en MikroTik."""
    # Verificar que el router exista y esté activo
    r = db.get(Gateway, payload.gateway_id)
    if not r or not r.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El router especificado no existe o está inactivo.",
        )

    last_name = (payload.last_name or "").strip()
    first_name = (payload.first_name or "").strip()
    name = (payload.name or f"{last_name} {first_name}".strip()).strip()
    if not name:
        name = f"{last_name} {first_name}".strip()

    # Verificar cédula única
    exists = db.query(Client).filter(Client.cedula == payload.cedula).first()
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe un cliente registrado con la cédula {payload.cedula}.",
        )

    # Si se envía plan_id, verificar que exista
    if payload.plan_id:
        p = db.get(Plan, payload.plan_id)
        if not p:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El plan especificado no existe.",
            )

    # Si es connection_type static, validar IP
    if payload.connection_type == "static":
        if not payload.ip:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La dirección IP es obligatoria para conexiones con IP Estática.",
            )
        # Validar IP única en este router
        exists_ip = db.query(StaticIP).filter(
            StaticIP.gateway_id == payload.gateway_id,
            StaticIP.ip == payload.ip
        ).first()
        if exists_ip:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"La dirección IP {payload.ip} ya está asignada a otro cliente en este router.",
            )
    elif payload.connection_type == "pppoe":
        if not payload.ppp_username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El usuario PPPoE es obligatorio para conexiones PPPoE.",
            )
        if not payload.ppp_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La contraseña PPPoE es obligatoria para conexiones PPPoE.",
            )
        if not payload.plan_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El plan es obligatorio para conexiones PPPoE.",
            )
        # Validar usuario único
        exists_user = db.query(PPPoESecret).filter(
            PPPoESecret.gateway_id == payload.gateway_id,
            PPPoESecret.ppp_username == payload.ppp_username
        ).first()
        if exists_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"El usuario PPPoE '{payload.ppp_username}' ya está asignado a otro cliente en este router.",
            )
        
        # Obtener el plan seleccionado
        plan = db.get(Plan, payload.plan_id)
        
        # Buscar o crear el PPPoEProfile local para este router y plan
        profile = db.query(PPPoEProfile).filter(
            PPPoEProfile.gateway_id == payload.gateway_id,
            PPPoEProfile.name == plan.name
        ).first()
        if not profile:
            profile = PPPoEProfile(
                name=plan.name,
                speed_down_mbps=plan.speed_down_mbps,
                speed_up_mbps=plan.speed_up_mbps,
                gateway_id=payload.gateway_id
            )
            db.add(profile)
            db.flush()

        # Asegurar perfil en MikroTik
        try:
            from app.services.mikrotik.pppoe import sync_pppoe_profile_in_gateway
            sync_pppoe_profile_in_gateway(r, plan)
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No se pudo configurar el perfil PPPoE en el router MikroTik. Error: {str(e)}"
            )

    client = Client(
        name=name,
        last_name=last_name,
        first_name=first_name,
        cedula=payload.cedula,
        phone=payload.phone,
        address=payload.address,
        latitude=payload.latitude,
        longitude=payload.longitude,
        gateway_id=payload.gateway_id,
        connection_type=payload.connection_type,
        active=True,
        email=payload.email,
        billing_start=payload.billing_start,
        billing_period_start_day=payload.billing_period_start_day,
        invoice_advance_days=payload.invoice_advance_days,
        billing_type=payload.billing_type,
        auto_apply_payment=payload.auto_apply_payment,
        use_auto_credit=payload.use_auto_credit,
        separate_proration=payload.separate_proration,
    )
    if payload.custom_service_ids:
        client.custom_services = db.query(CustomService).filter(CustomService.id.in_(payload.custom_service_ids)).all()
    if payload.created_at:
        client.created_at = payload.created_at
    db.add(client)
    db.flush()  # Generar ID del cliente antes de asociar el plan e IP / secreto

    # Registrar equipos asignados del inventario
    if payload.inventory_items:
        for item_data in payload.inventory_items:
            inv_item = db.get(InventoryItem, item_data.inventory_item_id)
            if not inv_item:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El artículo de inventario con ID {item_data.inventory_item_id} no existe.",
                )
            assignment = ClientInventoryItem(
                client_id=client.id,
                inventory_item_id=item_data.inventory_item_id,
                quantity=item_data.quantity,
                serial_number=item_data.serial_number,
                mac=item_data.mac,
                notes=item_data.notes,
            )
            db.add(assignment)

    # Crear el registro del plan inicial si se especificó
    if payload.plan_id:
        client_plan = ClientPlan(
            cliente_id=client.id,
            plan_id=payload.plan_id,
            fecha_inicio=datetime.now(),
            estado="activo",
        )
        db.add(client_plan)

    # Crear el registro de IP estática si se especificó
    if payload.connection_type == "static" and payload.ip:
        static_ip = StaticIP(
            client_id=client.id,
            ip=payload.ip,
            mac=payload.mac,
            gateway_id=payload.gateway_id,
            notes=payload.notes_ip,
        )
        db.add(static_ip)
        
        # Sincronizar con MikroTik síncronamente (address-list y cola simple)
        try:
            p = db.get(Plan, payload.plan_id) if payload.plan_id else None
            addr_list_name = get_clean_list_name(r.address_list or (p.address_list if p else None))
            sync_ip_in_address_list(r, payload.ip, client.name, list_name=addr_list_name)
            if p:
                sync_client_queue(
                    gateway=r,
                    client_name=client.name,
                    ip=payload.ip,
                    speed_up=p.speed_up_kbps,
                    speed_down=p.speed_down_kbps,
                    plan_name=p.name,
                    limit_at_up=p.limit_at_up_kbps,
                    limit_at_down=p.limit_at_down_kbps,
                    burst_threshold_up=p.burst_threshold_up_kbps,
                    burst_threshold_down=p.burst_threshold_down_kbps,
                    priority=p.priority,
                    parent=get_clean_parent_name(r.parent_queue or p.parent),
                )
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No se pudo registrar la IP o la cola en el router MikroTik. Verifique conectividad. Error: {str(e)}"
            )

    # Crear el registro PPPoE si se especificó
    elif payload.connection_type == "pppoe" and payload.ppp_username and payload.ppp_password:
        pppoe_sec = PPPoESecret(
            client_id=client.id,
            ppp_username=payload.ppp_username,
            ppp_password=encrypt_secret(payload.ppp_password),
            profile_id=profile.id,
            gateway_id=payload.gateway_id,
        )
        db.add(pppoe_sec)
        
        # Sincronizar con MikroTik
        try:
            sync_pppoe_secret_in_gateway(
                gateway=r,
                username=payload.ppp_username,
                password=payload.ppp_password,
                profile_name=profile.name,
                client_name=client.name,
                disabled=False
            )
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No se pudo registrar el secreto PPPoE en el router MikroTik. Verifique conectividad. Error: {str(e)}"
            )

    db.commit()
    db.refresh(client)

    log_event(
        db, AuditAction.CREATE_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
    )

    return _enrich_client(client, db)


@router.get("/{client_id}", response_model=ClientResponse)
def get_client(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """Obtiene el detalle de un cliente."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    return _enrich_client(client, db)


@router.put("/{client_id}", response_model=ClientResponse)
def update_client(
    client_id: uuid.UUID, payload: ClientUpdate, db: DBSession, _: AdminOrTechnician
) -> dict:
    """Edita datos básicos de un cliente y sincroniza cambios de IP/Router en MikroTik."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    update_data = payload.model_dump(exclude_unset=True)

    if "name" in update_data:
        client.name = update_data.pop("name")
    elif "last_name" in update_data or "first_name" in update_data:
        last_name = update_data.get("last_name", client.last_name) or ""
        first_name = update_data.get("first_name", client.first_name) or ""
        client.name = f"{last_name} {first_name}".strip()

    # Validar cédula única si cambia
    if "cedula" in update_data and update_data["cedula"] != client.cedula:
        exists = db.query(Client).filter(Client.cedula == update_data["cedula"]).first()
        if exists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ya existe un cliente registrado con la cédula {update_data['cedula']}.",
            )

    # Validar router si cambia
    if "gateway_id" in update_data and update_data["gateway_id"] != client.gateway_id:
        r = db.get(Gateway, update_data["gateway_id"])
        if not r or not r.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El router especificado no existe o está inactivo.",
            )

    old_ip = client.static_ip.ip if client.static_ip else None
    old_gateway = client.gateway
    old_gateway_id = client.gateway_id
    new_gateway_id = update_data.get("gateway_id", client.gateway_id)
    new_tipo = update_data.get("connection_type", client.connection_type)

    # Si el connection_type cambia a pppoe y tenía una IP estática, removerla de MikroTik y BD
    if new_tipo == "pppoe" and client.static_ip:
        try:
            remove_ip_from_address_list(client.gateway, client.static_ip.ip)
        except Exception as e:
            logger.warning(f"No se pudo remover la IP en MikroTik al cambiar a PPPoE: {e}")
        try:
            remove_client_queue(client.gateway, client.static_ip.ip)
        except Exception as e:
            logger.warning(f"No se pudo remover la cola en MikroTik al cambiar a PPPoE: {e}")
        db.delete(client.static_ip)

    # Si el connection_type cambia a static y tenía un secreto PPPoE, removerlo de MikroTik y BD
    if new_tipo == "static" and client.pppoe_secret:
        try:
            remove_pppoe_secret_from_gateway(client.gateway, client.pppoe_secret.ppp_username)
        except Exception as e:
            logger.warning(f"No se pudo remover el secreto PPPoE en MikroTik al cambiar a Estática: {e}")
        db.delete(client.pppoe_secret)

    # Si es static o cambia a static, validar y sincronizar IP
    if new_tipo == "static":
        ip_val = update_data.get("ip") if "ip" in update_data else old_ip
        if not ip_val:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La dirección IP es obligatoria para conexiones estáticas.",
            )

        # Validar IP única en el router de destino
        if "ip" in update_data or "gateway_id" in update_data:
            exists_ip = db.query(StaticIP).filter(
                StaticIP.gateway_id == new_gateway_id,
                StaticIP.ip == ip_val,
                StaticIP.client_id != client.id
            ).first()
            if exists_ip:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"La dirección IP {ip_val} ya está asignada a otro cliente en este router.",
                )

        new_gateway = db.get(Gateway, new_gateway_id)

        # Remover IP anterior si cambió de IP o de router
        if old_ip and (old_ip != ip_val or old_gateway_id != new_gateway_id):
            try:
                remove_ip_from_address_list(old_gateway, old_ip)
            except Exception as e:
                logger.warning(f"No se pudo remover la IP anterior en MikroTik: {e}")
            try:
                remove_client_queue(old_gateway, old_ip)
            except Exception as e:
                logger.warning(f"No se pudo remover la cola anterior en MikroTik: {e}")

        # Guardar en base de datos
        if client.static_ip:
            client.static_ip.ip = ip_val
            client.static_ip.mac = update_data.get("mac", client.static_ip.mac)
            client.static_ip.gateway_id = new_gateway_id
            client.static_ip.notes = update_data.get("notes_ip", client.static_ip.notes)
        else:
            client.static_ip = StaticIP(
                client_id=client.id,
                ip=ip_val,
                mac=update_data.get("mac"),
                gateway_id=new_gateway_id,
                notes=update_data.get("notes_ip"),
            )

        # Sincronizar o remover IP / queue en el router MikroTik según estado activo
        new_active_state = update_data.get("active", client.active)
        if new_active_state:
            try:
                active_client_plan = (
                    db.query(ClientPlan)
                    .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
                    .first()
                )
                p = active_client_plan.plan if active_client_plan else None
                addr_list_name = get_clean_list_name(new_gateway.address_list or (p.address_list if p else None))
                sync_ip_in_address_list(new_gateway, ip_val, update_data.get("name", client.name), list_name=addr_list_name)
                if p:
                    sync_client_queue(
                        gateway=new_gateway,
                        client_name=update_data.get("name", client.name),
                        ip=ip_val,
                        speed_up=p.speed_up_kbps,
                        speed_down=p.speed_down_kbps,
                        plan_name=p.name,
                        limit_at_up=p.limit_at_up_kbps,
                        limit_at_down=p.limit_at_down_kbps,
                        burst_threshold_up=p.burst_threshold_up_kbps,
                        burst_threshold_down=p.burst_threshold_down_kbps,
                        priority=p.priority,
                        parent=get_clean_parent_name(new_gateway.parent_queue or p.parent),
                    )
            except Exception as e:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Error al sincronizar con el router MikroTik: {str(e)}"
                )
        else:
            try:
                if old_ip:
                    remove_ip_from_address_list(old_gateway, old_ip)
                    remove_client_queue(old_gateway, old_ip)
                if ip_val != old_ip:
                    remove_ip_from_address_list(new_gateway, ip_val)
                    remove_client_queue(new_gateway, ip_val)
            except Exception as e:
                logger.warning(f"No se pudo remover la IP o cola en MikroTik al desactivar cliente: {e}")

    # Si es pppoe o cambia a pppoe, validar y sincronizar secreto
    elif new_tipo == "pppoe":
        user_val = update_data.get("ppp_username") or (client.pppoe_secret.ppp_username if client.pppoe_secret else None)
        pass_val = update_data.get("ppp_password") or (decrypt_secret(client.pppoe_secret.ppp_password) if client.pppoe_secret else None)

        if not user_val:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El usuario PPPoE es obligatorio para conexiones PPPoE.",
            )
        if not pass_val:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La contraseña PPPoE es obligatoria para conexiones PPPoE.",
            )

        # Validar usuario único en el router de destino
        if "ppp_username" in update_data or "gateway_id" in update_data:
            exists_user = db.query(PPPoESecret).filter(
                PPPoESecret.gateway_id == new_gateway_id,
                PPPoESecret.ppp_username == user_val,
                PPPoESecret.client_id != client.id
            ).first()
            if exists_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El usuario PPPoE '{user_val}' ya está asignado a otro cliente en este router.",
                )

        # Obtener el plan activo del cliente para configurar el perfil PPPoE
        active_client_plan = (
            db.query(ClientPlan)
            .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
            .first()
        )
        if not active_client_plan:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El cliente debe tener un plan activo para configurar una conexión PPPoE.",
            )
        plan = active_client_plan.plan

        # Buscar o crear el PPPoEProfile local para este router y plan
        profile = db.query(PPPoEProfile).filter(
            PPPoEProfile.gateway_id == new_gateway_id,
            PPPoEProfile.name == plan.name
        ).first()
        if not profile:
            profile = PPPoEProfile(
                name=plan.name,
                speed_down_mbps=plan.speed_down_mbps,
                speed_up_mbps=plan.speed_up_mbps,
                gateway_id=new_gateway_id
            )
            db.add(profile)
            db.flush()

        perf_id = profile.id
        new_gateway = db.get(Gateway, new_gateway_id)

        # Asegurar perfil en MikroTik
        try:
            from app.services.mikrotik.pppoe import sync_pppoe_profile_in_gateway
            sync_pppoe_profile_in_gateway(new_gateway, plan)
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"No se pudo configurar el perfil PPPoE en el router MikroTik. Error: {str(e)}"
            )

        new_gateway = db.get(Gateway, new_gateway_id)

        # Remover secreto anterior si cambió de usuario o de router
        old_user = client.pppoe_secret.ppp_username if client.pppoe_secret else None
        if old_user and (old_user != user_val or old_gateway_id != new_gateway_id):
            try:
                remove_pppoe_secret_from_gateway(old_gateway, old_user)
            except Exception as e:
                logger.warning(f"No se pudo remover el secreto PPPoE anterior en MikroTik: {e}")

        # Guardar en base de datos
        if client.pppoe_secret:
            client.pppoe_secret.ppp_username = user_val
            if "ppp_password" in update_data:
                client.pppoe_secret.ppp_password = encrypt_secret(update_data["ppp_password"])
            client.pppoe_secret.profile_id = perf_id
            client.pppoe_secret.gateway_id = new_gateway_id
        else:
            client.pppoe_secret = PPPoESecret(
                client_id=client.id,
                ppp_username=user_val,
                ppp_password=encrypt_secret(pass_val),
                profile_id=perf_id,
                gateway_id=new_gateway_id,
            )

        # Sincronizar secreto PPPoE en el router MikroTik según estado activo
        new_active_state = update_data.get("active", client.active)
        if new_active_state:
            try:
                sync_pppoe_secret_in_gateway(
                    gateway=new_gateway,
                    username=user_val,
                    password=pass_val,
                    profile_name=profile.name,
                    client_name=update_data.get("name", client.name),
                    disabled=False
                )
            except Exception as e:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Error al sincronizar con el router MikroTik: {str(e)}"
                )
        else:
            try:
                sync_pppoe_secret_in_gateway(
                    gateway=new_gateway,
                    username=user_val,
                    password=pass_val,
                    profile_name=profile.name,
                    client_name=update_data.get("name", client.name),
                    disabled=True
                )
                disconnect_pppoe_session(new_gateway, user_val)
            except Exception as e:
                logger.warning(f"No se pudo deshabilitar/desconectar la sesión PPPoE en MikroTik: {e}")

    # Actualizar campos básicos
    for field, value in update_data.items():
        if field not in ("ip", "mac", "notes_ip", "ppp_username", "ppp_password", "profile_id", "custom_service_ids", "inventory_items"):
            setattr(client, field, value)

    if "last_name" in update_data or "first_name" in update_data:
        client.name = f"{client.last_name} {client.first_name}".strip()

    if "custom_service_ids" in update_data:
        if update_data["custom_service_ids"]:
            client.custom_services = db.query(CustomService).filter(CustomService.id.in_(update_data["custom_service_ids"])).all()
        else:
            client.custom_services = []

    if "inventory_items" in update_data:
        # Reemplazar toda la lista de equipos asignados
        for existing in client.inventory_items:
            db.delete(existing)
        db.flush()
        for item_data in (update_data["inventory_items"] or []):
            inv_item = db.get(InventoryItem, item_data["inventory_item_id"])
            if not inv_item:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"El artículo de inventario con ID {item_data['inventory_item_id']} no existe.",
                )
            assignment = ClientInventoryItem(
                client_id=client.id,
                inventory_item_id=item_data["inventory_item_id"],
                quantity=item_data.get("quantity", 1),
                serial_number=item_data.get("serial_number"),
                mac=item_data.get("mac"),
                notes=item_data.get("notes"),
            )
            db.add(assignment)

    db.commit()
    db.refresh(client)

    return _enrich_client(client, db)


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> None:
    """
    Elimina un cliente de la base de datos (hard-delete).
    Remueve su IP estática del MikroTik.
    """
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    if client.static_ip:
        try:
            remove_ip_from_address_list(client.gateway, client.static_ip.ip)
        except Exception as e:
            logger.warning(f"No se pudo remover la IP en MikroTik al borrar cliente: {e}")
        try:
            remove_client_queue(client.gateway, client.static_ip.ip)
        except Exception as e:
            logger.warning(f"No se pudo remover la cola en MikroTik al borrar cliente: {e}")

    if client.connection_type == "pppoe" and client.pppoe_secret:
        try:
            remove_pppoe_secret_from_gateway(client.gateway, client.pppoe_secret.ppp_username)
        except Exception as e:
            logger.warning(f"No se pudo remover el secreto PPPoE en MikroTik al borrar cliente: {e}")

    db.delete(client)
    db.commit()


@router.get("/{client_id}/plans", response_model=list[ClientPlanResponse])
def get_client_plan_history(
    client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician
) -> list[ClientPlan]:
    """Obtiene el historial de planes de un cliente."""
    # Verificar que el cliente exista
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    return (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client_id)
        .order_by(ClientPlan.fecha_inicio.desc(), ClientPlan.estado.asc())
        .all()
    )


@router.post("/{client_id}/assign-plan", response_model=ClientPlanResponse)
def assign_client_plan(
    client_id: uuid.UUID, plan_id: uuid.UUID, db: DBSession, current_user: AdminOrTechnician
) -> ClientPlan:
    """
    Asigna un nuevo plan a un cliente.
    Desactiva el plan activo anterior marcándolo como cancelado/fecha_fin=ahora.
    """
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")

    now = datetime.now(timezone.utc)

    # Desactivar planes activos anteriores
    active_plans = (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client_id, ClientPlan.estado == "activo")
        .all()
    )

    for ap in active_plans:
        ap.estado = "cancelado"
        ap.fecha_fin = now

    # Sincronizar cola en MikroTik si el cliente es estático y tiene IP
    if client.connection_type == "static" and client.static_ip:
        try:
            addr_list_name = get_clean_list_name(client.gateway.address_list or plan.address_list)
            sync_ip_in_address_list(client.gateway, client.static_ip.ip, client.name, list_name=addr_list_name)
            sync_client_queue(
                gateway=client.gateway,
                client_name=client.name,
                ip=client.static_ip.ip,
                speed_up=plan.speed_up_kbps,
                speed_down=plan.speed_down_kbps,
                plan_name=plan.name,
                limit_at_up=plan.limit_at_up_kbps,
                limit_at_down=plan.limit_at_down_kbps,
                burst_threshold_up=plan.burst_threshold_up_kbps,
                burst_threshold_down=plan.burst_threshold_down_kbps,
                priority=plan.priority,
                parent=get_clean_parent_name(client.gateway.parent_queue or plan.parent),
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al actualizar la cola en MikroTik: {str(e)}"
            )
    
    # Sincronizar secreto PPPoE si el cliente es PPPoE y tiene secreto
    elif client.connection_type == "pppoe" and client.pppoe_secret:
        try:
            # 1. Buscar o crear el PPPoEProfile local para este router y plan
            profile = db.query(PPPoEProfile).filter(
                PPPoEProfile.gateway_id == client.gateway_id,
                PPPoEProfile.name == plan.name
            ).first()
            if not profile:
                profile = PPPoEProfile(
                    name=plan.name,
                    speed_down_mbps=plan.speed_down_mbps,
                    speed_up_mbps=plan.speed_up_mbps,
                    gateway_id=client.gateway_id
                )
                db.add(profile)
                db.flush()
            
            # 2. Asegurar perfil en MikroTik
            from app.services.mikrotik.pppoe import sync_pppoe_profile_in_gateway, sync_pppoe_secret_in_gateway
            sync_pppoe_profile_in_gateway(client.gateway, plan)
            
            # 3. Actualizar la relación del secreto
            client.pppoe_secret.profile_id = profile.id
            
            # 4. Sincronizar secreto en MikroTik con el nuevo perfil
            password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
            sync_pppoe_secret_in_gateway(
                gateway=client.gateway,
                username=client.pppoe_secret.ppp_username,
                password=password_dec,
                profile_name=profile.name,
                client_name=client.name,
                disabled=not client.active
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al actualizar el perfil/secreto PPPoE en MikroTik: {str(e)}"
            )

    # Crear el nuevo registro del plan
    new_client_plan = ClientPlan(
        cliente_id=client_id,
        plan_id=plan_id,
        fecha_inicio=now,
        estado="activo",
    )
    db.add(new_client_plan)
    db.commit()
    db.refresh(new_client_plan)

    log_event(
        db, AuditAction.ASSIGN_PLAN,
        entity_type="Client", entity_id=str(client_id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"plan_name": plan.name, "plan_id": str(plan_id)},
    )

    return new_client_plan


@router.post("/{client_id}/sync-gateway")
def sync_client_gateway(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """Sincroniza manualmente la dirección IP estática y la cola de ancho de banda en el MikroTik."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if not client.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente está inactivo.")
    if client.connection_type != "static" or not client.static_ip:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente no posee IP estática activa.")

    active_client_plan = (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
        .first()
    )

    try:
        p = active_client_plan.plan if active_client_plan else None
        addr_list_name = get_clean_list_name(client.gateway.address_list or (p.address_list if p else None))
        sync_ip_in_address_list(client.gateway, client.static_ip.ip, client.name, list_name=addr_list_name)
        if p:
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
        return {"status": "success", "message": "Sincronización de IP y cola exitosa en el router MikroTik."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al contactar el router MikroTik: {str(e)}"
        )


@router.post("/{client_id}/toggle-queue")
def toggle_client_queue_endpoint(
    client_id: uuid.UUID,
    disabled: bool,
    db: DBSession,
    current_user: AdminOrTechnician
) -> dict:
    """Habilita o desactiva la cola simple del cliente en MikroTik."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if client.connection_type != "static" or not client.static_ip:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El cliente no posee IP estática configurada."
        )

    try:
        toggle_client_queue(client.gateway, client.static_ip.ip, disabled)
        log_event(
            db, AuditAction.TOGGLE_QUEUE,
            entity_type="Client", entity_id=str(client_id), entity_name=client.name,
            user_id=current_user.id, user_name=current_user.name,
            detail={"disabled": disabled, "ip": client.static_ip.ip},
        )
        return {
            "status": "success",
            "message": f"Cola {'deshabilitada' if disabled else 'habilitada'} exitosamente en MikroTik."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo al actualizar el estado de la cola en MikroTik: {str(e)}"
        )


@router.post("/{client_id}/suspend", response_model=SuspensionLogResponse)
def suspend_client(
    client_id: uuid.UUID,
    reason: str,
    db: DBSession,
    current_user: CurrentUser,
    reactivate_at: datetime | None = None,
) -> SuspensionLog:
    """
    Suspende a un cliente:
    - Cambia estado a inactivo (client.active = False).
    - Cambia estado del plan activo a 'suspendido'.
    - Agrega IP a address-list 'suspendidos' en MikroTik (si es static).
    - Deshabilita la cola simple en MikroTik (si es static).
    - Crea un registro en SuspensionLog.
    - Envía una notificación Twilio.
    - Si se indica reactivate_at, programa la reactivación automática a esa fecha.
    """
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if not client.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente ya está suspendido o inactivo.")
    if reactivate_at is not None and _is_in_the_past(reactivate_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La fecha de reactivación debe ser futura.")

    # 1. Actualizar estado del cliente y su plan
    client.active = False
    client.scheduled_reactivation = reactivate_at

    active_plan = (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "activo")
        .first()
    )
    if active_plan:
        active_plan.estado = "suspendido"

    # 2. Lógica de MikroTik (si es static y tiene IP, o pppoe con secret)
    if client.connection_type == "static" and client.static_ip:
        try:
            suspend_ip_in_firewall(client.gateway, client.static_ip.ip, client.name)
            toggle_client_queue(client.gateway, client.static_ip.ip, disabled=True)
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al aplicar suspensión en MikroTik: {str(e)}"
            )
    elif client.connection_type == "pppoe" and client.pppoe_secret:
        try:
            password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
            profile_name = client.pppoe_secret.profile.name if client.pppoe_secret.profile else "default"
            sync_pppoe_secret_in_gateway(
                gateway=client.gateway,
                username=client.pppoe_secret.ppp_username,
                password=password_dec,
                profile_name=profile_name,
                client_name=client.name,
                disabled=True
            )
            disconnect_pppoe_session(client.gateway, client.pppoe_secret.ppp_username)
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al aplicar suspensión en MikroTik para cuenta PPPoE: {str(e)}"
            )

    # 3. Crear registro de log
    log = SuspensionLog(
        client_id=client.id,
        reason=reason,
        suspended_at=datetime.now(),
        user_id=current_user.id
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    # 4. Enviar notificación (no bloqueante en caso de error de red/config de Twilio)
    try:
        send_suspension_notification(client.name, client.phone, is_suspension=True)
    except Exception as e:
        logger.warning(f"Error al disparar notificación de suspensión: {e}")

    log_event(
        db, AuditAction.SUSPEND_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"reason": reason, "reactivate_at": reactivate_at.isoformat() if reactivate_at else None},
    )

    return log


@router.post("/{client_id}/reactivate", response_model=SuspensionLogResponse)
def reactivate_client(
    client_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> SuspensionLog:
    """
    Reactiva a un cliente suspendido:
    - Cambia estado a activo (client.active = True).
    - Cambia estado del plan suspendido de vuelta a 'activo'.
    - Remueve IP de address-list 'suspendidos' en MikroTik.
    - Habilita la cola simple en MikroTik.
    - Cierra el registro en SuspensionLog.
    - Envía una notificación Twilio.
    """
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if client.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente ya está activo.")

    # 1. Actualizar estado
    client.active = True
    client.scheduled_reactivation = None

    suspended_plan = (
        db.query(ClientPlan)
        .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "suspendido")
        .first()
    )
    if suspended_plan:
        suspended_plan.estado = "activo"

    # 2. Lógica de MikroTik (si es static y tiene IP, o pppoe con secret)
    if client.connection_type == "static" and client.static_ip:
        try:
            unsuspend_ip_in_firewall(client.gateway, client.static_ip.ip)
            toggle_client_queue(client.gateway, client.static_ip.ip, disabled=False)
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al revertir suspensión en MikroTik: {str(e)}"
            )
    elif client.connection_type == "pppoe" and client.pppoe_secret:
        try:
            password_dec = decrypt_secret(client.pppoe_secret.ppp_password)
            profile_name = client.pppoe_secret.profile.name if client.pppoe_secret.profile else "default"
            sync_pppoe_secret_in_gateway(
                gateway=client.gateway,
                username=client.pppoe_secret.ppp_username,
                password=password_dec,
                profile_name=profile_name,
                client_name=client.name,
                disabled=False
            )
        except Exception as e:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Fallo al reactivar cuenta PPPoE en MikroTik: {str(e)}"
            )

    # 3. Actualizar registro de log activo (el último con reactivated_at nula)
    log = (
        db.query(SuspensionLog)
        .filter(SuspensionLog.client_id == client.id, SuspensionLog.reactivated_at == None)
        .order_by(SuspensionLog.suspended_at.desc())
        .first()
    )
    if not log:
        # Si no había un log de suspensión activo por algún motivo, crear uno vacío para retornar
        log = SuspensionLog(
            client_id=client.id,
            reason="Reactivación sin log de suspensión previo",
            suspended_at=datetime.now(),
        )
        db.add(log)

    log.reactivated_at = datetime.now()
    log.user_id = current_user.id  # Usuario que reactiva
    db.commit()
    db.refresh(log)

    # 4. Enviar notificación
    try:
        send_suspension_notification(client.name, client.phone, is_suspension=False)
    except Exception as e:
        logger.warning(f"Error al disparar notificación de reactivación: {e}")

    log_event(
        db, AuditAction.ACTIVATE_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
    )

    return log


@router.post("/{client_id}/defer-suspension")
def defer_client_suspension(
    client_id: uuid.UUID,
    defer_until: datetime,
    reason: str,
    db: DBSession,
    current_user: CurrentUser,
) -> dict:
    """
    Programa una suspensión futura para el cliente:
    - El cliente permanece activo.
    - Se guarda la fecha programada en scheduled_suspension.
    - El scheduler ejecutará la suspensión cuando llegue esa fecha.
    """
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if not client.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente ya está suspendido.")
    if _is_in_the_past(defer_until):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La fecha de aplazamiento debe ser futura.")

    client.scheduled_suspension = defer_until
    client.scheduled_suspension_reason = reason
    db.commit()

    log_event(
        db, AuditAction.SUSPEND_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"reason": reason, "deferred_until": defer_until.isoformat(), "type": "deferral"},
    )

    return {"detail": "Suspensión programada correctamente.", "defer_until": defer_until.isoformat()}


@router.delete("/{client_id}/defer-suspension")
def cancel_deferred_suspension(
    client_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> dict:
    """Cancela una suspensión programada, dejando al cliente activo sin fecha de corte."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if not client.scheduled_suspension:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente no tiene ninguna suspensión programada.")

    client.scheduled_suspension = None
    client.scheduled_suspension_reason = None
    db.commit()

    log_event(
        db, AuditAction.ACTIVATE_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"type": "cancel_deferral"},
    )

    return {"detail": "Suspensión programada cancelada correctamente."}


@router.post("/{client_id}/scheduled-reactivation")
def schedule_reactivation(
    client_id: uuid.UUID,
    reactivate_at: datetime,
    db: DBSession,
    current_user: CurrentUser,
) -> dict:
    """
    Programa (o reprograma) la reactivación automática de un cliente que ya está suspendido:
    - El cliente permanece suspendido.
    - Se guarda la fecha en scheduled_reactivation.
    - La tarea process_scheduled_reactivations lo reactivará automáticamente al llegar esa fecha.
    """
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if client.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente no está suspendido.")
    if _is_in_the_past(reactivate_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La fecha de reactivación debe ser futura.")

    client.scheduled_reactivation = reactivate_at
    db.commit()

    log_event(
        db, AuditAction.ACTIVATE_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"type": "schedule_reactivation", "reactivate_at": reactivate_at.isoformat()},
    )

    return {"detail": "Reactivación programada correctamente.", "reactivate_at": reactivate_at.isoformat()}


@router.delete("/{client_id}/scheduled-reactivation")
def cancel_scheduled_reactivation(
    client_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> dict:
    """Cancela la reactivación automática programada de un cliente suspendido, dejándolo suspendido indefinidamente."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
    if not client.scheduled_reactivation:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El cliente no tiene ninguna reactivación programada.")

    client.scheduled_reactivation = None
    db.commit()

    log_event(
        db, AuditAction.SUSPEND_CLIENT,
        entity_type="Client", entity_id=str(client.id), entity_name=client.name,
        user_id=current_user.id, user_name=current_user.name,
        detail={"type": "cancel_scheduled_reactivation"},
    )

    return {"detail": "Reactivación programada cancelada correctamente."}


@router.get("/{client_id}/suspensions", response_model=list[SuspensionLogResponse])
def get_client_suspension_history(
    client_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician
) -> list[SuspensionLog]:
    """Obtiene el historial de suspensiones de un cliente."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    return (
        db.query(SuspensionLog)
        .filter(SuspensionLog.client_id == client_id)
        .order_by(SuspensionLog.suspended_at.desc())
        .all()
    )


@router.get("/{client_id}/payments", response_model=list[PaymentResponse])
def get_client_payments(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[ClientPayment]:
    """Obtiene el historial de pagos real del cliente ordenado por fecha de pago desc."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
        
    payments = (
        db.query(ClientPayment)
        .filter(ClientPayment.client_id == client_id)
        .order_by(ClientPayment.payment_date.desc())
        .all()
    )
    return payments


@router.get("/{client_id}/invoices", response_model=list[InvoiceResponse])
def get_client_invoices(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[Invoice]:
    """Obtiene el historial de facturas emitidas al cliente ordenado por fecha de emisión desc."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
        
    invoices = (
        db.query(Invoice)
        .filter(Invoice.client_id == client_id)
        .order_by(Invoice.issue_date.desc())
        .all()
    )
    return invoices


@router.get("/{client_id}/tickets", response_model=list[TicketResponse])
def get_client_tickets(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> list[ClientTicket]:
    """Obtiene los tickets de soporte del cliente, sembrando un mock si está vacío."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
        
    tickets = db.query(ClientTicket).filter(ClientTicket.client_id == client_id).all()

    if not tickets:
        from datetime import datetime, timedelta
        t = ClientTicket(
            client_id=client_id,
            title="Intermitencia de señal por la tarde",
            description="El cliente reporta que la señal de internet se vuelve lenta e intermitente de 6 PM a 8 PM.",
            priority="medium",
            status="resolved",
            created_at=datetime.now() - timedelta(days=12),
            updated_at=datetime.now() - timedelta(days=10)
        )
        db.add(t)
        db.commit()
        tickets = [t]

    return tickets


@router.post("/{client_id}/tickets", response_model=TicketResponse, status_code=status.HTTP_201_CREATED)
def create_client_ticket(client_id: uuid.UUID, payload: TicketCreate, db: DBSession, _: AdminOrTechnician) -> ClientTicket:
    """Crea un nuevo ticket de soporte para el cliente."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")

    ticket = ClientTicket(
        client_id=client_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        status="open",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.get("/{client_id}/traffic", response_model=TrafficResponse)
def get_client_traffic(client_id: uuid.UUID, db: DBSession, _: AdminOrTechnician) -> dict:
    """Obtiene el historial de consumo de tráfico mensual del cliente."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cliente no encontrado")
        
    client_seed = sum(ord(c) for c in str(client_id))
    
    months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio"]
    history = []
    
    for i, month in enumerate(months):
        base_down = 120 + ((client_seed + i * 37) % 150)
        base_up = 15 + ((client_seed * 2 + i * 13) % 40)
        
        history.append({
            "month": month,
            "down_gb": round(base_down, 2),
            "up_gb": round(base_up, 2)
        })

    return {
        "client_id": client_id,
        "history": history
    }


from app.schemas.client_import import ImportValidationResponse, BulkImportPayload


@router.post("/import/validate", response_model=ImportValidationResponse)
def validate_import_data(
    payload: list[dict],
    db: DBSession,
    _: AdminOrTechnician
) -> ImportValidationResponse:
    """
    Valida un listado de filas JSON provenientes del CSV mapeado en el frontend.
    Verifica campos requeridos, duplicados de cédula, validez de cédula ecuatoriana,
    disponibilidad de IP o usuario PPPoE en el router, etc.
    """
    import uuid
    from app.schemas.client_import import ImportValidationResponse, CSVRowValidation
    from app.core.validators import validate_ecuadorian_cedula
    from app.models.gateway import Gateway
    from app.models.plan import Plan
    from app.models.static_ip import StaticIP
    from app.models.pppoe_secret import PPPoESecret

    def split_name_helper(full_name: str) -> tuple[str, str]:
        trimmed = (full_name or "").strip()
        if ',' in trimmed:
            parts = trimmed.split(',')
            return parts[0].strip(), ",".join(parts[1:]).strip()
        words = trimmed.split()
        if len(words) <= 1:
            return "", trimmed
        elif len(words) == 2:
            return words[1], words[0]
        elif len(words) == 3:
            return " ".join(words[1:]), words[0]
        else:
            middle = len(words) // 2
            return " ".join(words[middle:]), " ".join(words[:middle])

    rows_validation = []
    detected_gateways = set()
    detected_plans = set()
    
    seen_cedulas = set()
    seen_ips = {}  # gateway_id/name -> set
    seen_ppp_users = {}  # gateway_id/name -> set

    for idx, row in enumerate(payload):
        errors = []
        warnings = []
        
        last_name = row.get("apellidos", "").strip() if row.get("apellidos") else ""
        first_name = row.get("nombres", "").strip() if row.get("nombres") else ""

        if not last_name and not first_name and row.get("nombre"):
            last_name, first_name = split_name_helper(row.get("nombre"))

        name = f"{last_name} {first_name}".strip()
        row["nombre"] = name
        row["apellidos"] = last_name
        row["nombres"] = first_name
        cedula = row.get("cedula", "").strip() if row.get("cedula") else ""
        phone = row.get("telefono", "").strip() if row.get("telefono") else ""
        address = row.get("direccion", "").strip() if row.get("direccion") else ""
        connection_type = row.get("tipo", "static").strip().lower() if row.get("tipo") else "static"

        if not last_name:
            errors.append("Apellidos son requeridos.")
        if not first_name:
            errors.append("Nombres son requeridos.")
        if not cedula:
            errors.append("La cédula es requerida.")
        if not phone:
            errors.append("El teléfono es requerido.")
        if not address:
            errors.append("La dirección es requerida.")

        if connection_type not in ("static", "pppoe"):
            errors.append("El tipo de conexión debe ser 'static' o 'pppoe'.")

        if cedula:
            if not validate_ecuadorian_cedula(cedula):
                errors.append(f"La cédula o RUC '{cedula}' no es una cédula ecuatoriana válida.")
            elif cedula in seen_cedulas:
                errors.append(f"La cédula '{cedula}' está duplicada dentro del archivo de importación.")
            else:
                seen_cedulas.add(cedula)
                exists_cedula = db.query(Client).filter(Client.cedula == cedula).first()
                if exists_cedula:
                    errors.append(f"La cédula '{cedula}' ya está registrada en el sistema (pertenece a {exists_cedula.name}).")

        gateway_raw = row.get("gateway", "").strip() if row.get("gateway") else ""
        plan_raw = row.get("plan", "").strip() if row.get("plan") else ""

        if gateway_raw:
            detected_gateways.add(gateway_raw)
        else:
            errors.append("El router es requerido.")

        if plan_raw:
            detected_plans.add(plan_raw)

        gateway = None
        if gateway_raw:
            try:
                gateway_uuid = uuid.UUID(gateway_raw)
                gateway = db.get(Gateway, gateway_uuid)
            except ValueError:
                gateway = db.query(Gateway).filter(Gateway.name.ilike(gateway_raw)).first()

            if not gateway:
                errors.append(f"El router '{gateway_raw}' no existe en el sistema.")
            elif not gateway.active:
                errors.append(f"El router '{gateway.name}' está inactivo.")

        plan = None
        if plan_raw:
            try:
                plan_uuid = uuid.UUID(plan_raw)
                plan = db.get(Plan, plan_uuid)
            except ValueError:
                plan = db.query(Plan).filter(Plan.name.ilike(plan_raw)).first()
            
            if not plan:
                warnings.append(f"El plan '{plan_raw}' no fue encontrado. Se requerirá mapeo.")

        if gateway and connection_type == "static":
            ip = row.get("ip", "").strip() if row.get("ip") else ""
            mac = row.get("mac", "").strip() if row.get("mac") else ""
            if not ip:
                errors.append("La dirección IP es requerida para conexiones con IP Estática.")
            else:
                gateway_key = str(gateway.id)
                if gateway_key not in seen_ips:
                    seen_ips[gateway_key] = set()

                if ip in seen_ips[gateway_key]:
                    errors.append(f"La IP '{ip}' está duplicada en este router dentro del archivo de importación.")
                else:
                    seen_ips[gateway_key].add(ip)
                    exists_ip = db.query(StaticIP).filter(
                        StaticIP.gateway_id == gateway.id,
                        StaticIP.ip == ip
                    ).first()
                    if exists_ip:
                        errors.append(f"La dirección IP '{ip}' ya está asignada a otro cliente en este router.")

            if mac and len(mac) != 17:
                errors.append("La dirección MAC debe tener formato válido de 17 caracteres (ej: XX:XX:XX:XX:XX:XX).")

        elif gateway and connection_type == "pppoe":
            ppp_username = row.get("ppp_username", "").strip() if row.get("ppp_username") else ""
            ppp_password = row.get("ppp_password", "").strip() if row.get("ppp_password") else ""

            if not ppp_username:
                errors.append("El usuario PPPoE es requerido.")
            else:
                gateway_key = str(gateway.id)
                if gateway_key not in seen_ppp_users:
                    seen_ppp_users[gateway_key] = set()

                if ppp_username in seen_ppp_users[gateway_key]:
                    errors.append(f"El usuario PPPoE '{ppp_username}' está duplicado en este router dentro del archivo.")
                else:
                    seen_ppp_users[gateway_key].add(ppp_username)
                    exists_user = db.query(PPPoESecret).filter(
                        PPPoESecret.gateway_id == gateway.id,
                        PPPoESecret.ppp_username == ppp_username
                    ).first()
                    if exists_user:
                        errors.append(f"El usuario PPPoE '{ppp_username}' ya está asignado en este router.")

            if not ppp_password:
                errors.append("La contraseña PPPoE es requerida.")
            if not plan_raw:
                errors.append("El plan es obligatorio para conexiones PPPoE.")

        rows_validation.append(
            CSVRowValidation(
                index=idx,
                data=row,
                valid=len(errors) == 0,
                errors=errors,
                warnings=warnings
            )
        )

    valid_count = sum(1 for r in rows_validation if r.valid)
    return ImportValidationResponse(
        rows=rows_validation,
        total_rows=len(payload),
        valid_rows=valid_count,
        invalid_rows=len(payload) - valid_count,
        detected_gateways=sorted(list(detected_gateways)),
        detected_plans=sorted(list(detected_plans))
    )


@router.post("/import/commit")
def commit_import_clients(
    payload: BulkImportPayload,
    db: DBSession,
    _: AdminOrTechnician
) -> dict:
    """
    Realiza la importación definitiva de la lista de clientes pre-validados.
    Intenta crear cada cliente individualmente. Si un cliente falla,
    se registra el error y se continúa con el siguiente para no bloquear toda la importación.
    """
    import uuid
    import logging as _logging
    _logger = _logging.getLogger(__name__)
    from app.schemas.client_import import BulkImportPayload
    from app.models.gateway import Gateway
    from app.models.plan import Plan
    from app.models.static_ip import StaticIP
    from app.models.pppoe_secret import PPPoESecret
    from app.models.pppoe_profile import PPPoEProfile
    from app.models.client_plan import ClientPlan
    from app.models.custom_service import CustomService
    from app.services.mikrotik.address_list import sync_ip_in_address_list
    from app.services.mikrotik.queue import sync_client_queue
    from app.services.mikrotik.pppoe import sync_pppoe_secret_in_gateway, sync_pppoe_profile_in_gateway
    from app.core.security import encrypt_secret
    from app.services.mikrotik.sync_queue import enqueue_sync

    successes = []
    failures = []
    
    for idx, client_data in enumerate(payload.clients):
        try:
            with db.begin_nested():
                r = db.get(Gateway, client_data.gateway_id)
                if not r or not r.active:
                    raise Exception("El router especificado no existe o está inactivo.")
                
                exists = db.query(Client).filter(Client.cedula == client_data.cedula).first()
                if exists:
                    raise Exception(f"Ya existe un cliente con la cédula {client_data.cedula}.")
                
                if client_data.plan_id:
                    p = db.get(Plan, client_data.plan_id)
                    if not p:
                        raise Exception("El plan especificado no existe.")
                
                if client_data.connection_type == "static":
                    if not client_data.ip:
                        raise Exception("La dirección IP es obligatoria para conexiones con IP Estática.")
                    exists_ip = db.query(StaticIP).filter(
                        StaticIP.gateway_id == client_data.gateway_id,
                        StaticIP.ip == client_data.ip
                    ).first()
                    if exists_ip:
                        raise Exception(f"La dirección IP {client_data.ip} ya está asignada en este router.")
                
                elif client_data.connection_type == "pppoe":
                    if not client_data.ppp_username:
                        raise Exception("El usuario PPPoE es obligatorio para conexiones PPPoE.")
                    if not client_data.ppp_password:
                        raise Exception("La contraseña PPPoE es obligatoria para conexiones PPPoE.")
                    if not client_data.plan_id:
                        raise Exception("El plan es obligatorio para conexiones PPPoE.")
                    
                    exists_user = db.query(PPPoESecret).filter(
                        PPPoESecret.gateway_id == client_data.gateway_id,
                        PPPoESecret.ppp_username == client_data.ppp_username
                    ).first()
                    if exists_user:
                        raise Exception(f"El usuario PPPoE '{client_data.ppp_username}' ya está asignado en este router.")
                    
                    plan = db.get(Plan, client_data.plan_id)
                    profile = db.query(PPPoEProfile).filter(
                        PPPoEProfile.gateway_id == client_data.gateway_id,
                        PPPoEProfile.name == plan.name
                    ).first()
                    if not profile:
                        profile = PPPoEProfile(
                            name=plan.name,
                            speed_down_mbps=plan.speed_down_mbps,
                            speed_up_mbps=plan.speed_up_mbps,
                            gateway_id=client_data.gateway_id
                        )
                        db.add(profile)
                        db.flush()
                    
                client = Client(
                    name=f"{client_data.last_name} {client_data.first_name}".strip(),
                    last_name=client_data.last_name,
                    first_name=client_data.first_name,
                    cedula=client_data.cedula,
                    phone=client_data.phone,
                    address=client_data.address,
                    latitude=client_data.latitude,
                    longitude=client_data.longitude,
                    gateway_id=client_data.gateway_id,
                    connection_type=client_data.connection_type,
                    active=True,
                    email=client_data.email,
                    billing_start=client_data.billing_start,
                    billing_period_start_day=client_data.billing_period_start_day,
                    invoice_advance_days=client_data.invoice_advance_days,
                    billing_type=client_data.billing_type,
                    auto_apply_payment=client_data.auto_apply_payment,
                    use_auto_credit=client_data.use_auto_credit,
                    separate_proration=client_data.separate_proration,
                )
                if client_data.custom_service_ids:
                    client.custom_services = db.query(CustomService).filter(CustomService.id.in_(client_data.custom_service_ids)).all()
                if client_data.created_at:
                    client.created_at = client_data.created_at
                db.add(client)
                db.flush()
                
                if client_data.plan_id:
                    client_plan = ClientPlan(
                        cliente_id=client.id,
                        plan_id=client_data.plan_id,
                        fecha_inicio=datetime.now(),
                        estado="activo",
                    )
                    db.add(client_plan)
                
                if client_data.connection_type == "static" and client_data.ip:
                    static_ip = StaticIP(
                        client_id=client.id,
                        ip=client_data.ip,
                        mac=client_data.mac,
                        gateway_id=client_data.gateway_id,
                        notes=client_data.notes_ip,
                    )
                    db.add(static_ip)
                    # Precalcular addr_list_name aquí (solo acceso a BD, no MikroTik)
                    p = db.get(Plan, client_data.plan_id) if client_data.plan_id else None
                    addr_list_name = get_clean_list_name(r.address_list or (p.address_list if p else None))

                elif client_data.connection_type == "pppoe" and client_data.ppp_username and client_data.ppp_password:
                    pppoe_sec = PPPoESecret(
                        client_id=client.id,
                        ppp_username=client_data.ppp_username,
                        ppp_password=encrypt_secret(client_data.ppp_password),
                        profile_id=profile.id,
                        gateway_id=client_data.gateway_id,
                    )
                    db.add(pppoe_sec)
                    db.flush()  # genera pppoe_sec.id antes del commit

            # ── Cliente en BD confirmado ──────────────────────────────────────
            db.commit()

            # ── Sync MikroTik (fuera del savepoint; falla → encolar, nunca revertir el cliente) ──
            _sync_pending = False

            if client_data.connection_type == "static" and client_data.ip:
                try:
                    sync_ip_in_address_list(r, client_data.ip, client.name, list_name=addr_list_name)
                except Exception as _e:
                    enqueue_sync(db, client.gateway_id, client.id, "add_to_address_list", {
                        "ip": client_data.ip,
                        "client_name": client.name,
                        "list_name": addr_list_name or "isp_clientes",
                    })
                    _sync_pending = True
                    _logger.warning(f"[Import] address_list → encolado ({client_data.cedula}): {_e}")
                if p:
                    try:
                        sync_client_queue(
                            gateway=r,
                            client_name=client.name,
                            ip=client_data.ip,
                            speed_up=p.speed_up_kbps,
                            speed_down=p.speed_down_kbps,
                            plan_name=p.name,
                            limit_at_up=p.limit_at_up_kbps,
                            limit_at_down=p.limit_at_down_kbps,
                            burst_threshold_up=p.burst_threshold_up_kbps,
                            burst_threshold_down=p.burst_threshold_down_kbps,
                            priority=p.priority,
                            parent=get_clean_parent_name(r.parent_queue or p.parent),
                        )
                    except Exception as _e:
                        enqueue_sync(db, client.gateway_id, client.id, "add_queue", {
                            "client_name": client.name,
                            "ip": client_data.ip,
                            "speed_up": p.speed_up_kbps,
                            "speed_down": p.speed_down_kbps,
                            "plan_name": p.name,
                            "limit_at_up": p.limit_at_up_kbps,
                            "limit_at_down": p.limit_at_down_kbps,
                            "burst_threshold_up": p.burst_threshold_up_kbps,
                            "burst_threshold_down": p.burst_threshold_down_kbps,
                            "priority": p.priority,
                            "parent": get_clean_parent_name(r.parent_queue or p.parent),
                        })
                        _sync_pending = True
                        _logger.warning(f"[Import] queue → encolado ({client_data.cedula}): {_e}")

            elif client_data.connection_type == "pppoe" and client_data.ppp_username:
                try:
                    sync_pppoe_profile_in_gateway(r, plan)
                except Exception as _e:
                    enqueue_sync(db, client.gateway_id, client.id, "add_pppoe_profile", {
                        "plan_id": str(plan.id),
                    })
                    _sync_pending = True
                    _logger.warning(f"[Import] pppoe_profile → encolado ({plan.name}): {_e}")
                try:
                    sync_pppoe_secret_in_gateway(
                        gateway=r,
                        username=client_data.ppp_username,
                        password=client_data.ppp_password,
                        profile_name=profile.name,
                        client_name=client.name,
                        disabled=False,
                    )
                except Exception as _e:
                    enqueue_sync(db, client.gateway_id, client.id, "add_pppoe_secret", {
                        "pppoe_secret_id": str(pppoe_sec.id),
                        "profile_name": profile.name,
                        "client_name": client.name,
                        "disabled": False,
                    })
                    _sync_pending = True
                    _logger.warning(f"[Import] pppoe_secret → encolado ({client_data.cedula}): {_e}")

            if _sync_pending:
                db.commit()

            successes.append({
                "name": client_data.name,
                "cedula": client_data.cedula,
                "sync_pending": _sync_pending,
            })
        except Exception as e:
            db.rollback()
            failures.append({
                "name": client_data.name,
                "cedula": client_data.cedula,
                "error": str(e)
            })
            
    sync_pending_count = sum(1 for s in successes if s.get("sync_pending"))
    return {
        "success": len(failures) == 0,
        "total": len(payload.clients),
        "imported_count": len(successes),
        "failed_count": len(failures),
        "sync_pending_count": sync_pending_count,
        "successes": successes,
        "failures": failures,
    }


