"""
Endpoints API para ClientPayment (Pagos)
"""
import uuid
import logging
from datetime import datetime, time
from fastapi import APIRouter, HTTPException, status, Depends, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import AdminOrTechnician, DBSession, CurrentUser
from app.models.payment import ClientPayment
from app.models.invoice import Invoice
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.suspension_log import SuspensionLog
from app.models.company import Company
from app.schemas.payment import PaymentCreate, PaymentResponse
from app.core.security import decrypt_secret
from app.services.mikrotik.pppoe import sync_pppoe_secret_in_gateway
from app.services.mikrotik.address_list import unsuspend_ip_in_firewall
from app.services.mikrotik.queue import toggle_client_queue
from app.services.notifications.twilio_service import send_suspension_notification
from app.services.pdf_generator import generate_receipt_pdf

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("", response_model=PaymentResponse)
def create_payment(
    payment_in: PaymentCreate,
    db: DBSession,
    current_user: CurrentUser
) -> ClientPayment:
    """
    Registra un pago manual para una factura:
    - Marca la factura como 'pagada'.
    - Crea el registro del pago asignando el usuario que cobra.
    - Si el cliente está suspendido/inactivo, lo reactiva automáticamente en la base de datos y en MikroTik.
    """
    invoice = db.get(Invoice, payment_in.invoice_id)
    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
        
    if invoice.status == "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La factura ya se encuentra pagada"
        )

    # 1. Marcar la factura como pagada
    invoice.status = "paid"

    # 2. Registrar el pago
    payment = ClientPayment(
        client_id=invoice.client_id,
        invoice_id=invoice.id,
        amount=payment_in.amount,
        method=payment_in.method,
        status="completed",
        notes=payment_in.notes,
        user_id=current_user.id
    )
    db.add(payment)

    client = invoice.client

    # 3. Reactivar cliente si estaba inactivo/suspendido
    if not client.active:
        logger.info(f"Detectado cliente suspendido {client.name} ({client.id}). Procediendo a reactivación...")
        client.active = True

        # Activar su plan suspendido
        suspended_plan = (
            db.query(ClientPlan)
            .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "suspendido")
            .first()
        )
        if suspended_plan:
            suspended_plan.estado = "activo"
            
        # Reactivar en MikroTik
        if client.connection_type == "static" and client.static_ip:
            try:
                unsuspend_ip_in_firewall(client.gateway, client.static_ip.ip)
                toggle_client_queue(client.gateway, client.static_ip.ip, disabled=False)
            except Exception as e:
                db.rollback()
                logger.error(f"Fallo al reactivar en MikroTik para IP Estática: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Pago registrado pero falló la reactivación en MikroTik: {str(e)}"
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
                logger.error(f"Fallo al reactivar en MikroTik para cuenta PPPoE: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Pago registrado pero falló la reactivación de cuenta PPPoE en MikroTik: {str(e)}"
                )
                
        # Cerrar el SuspensionLog activo
        log = (
            db.query(SuspensionLog)
            .filter(SuspensionLog.client_id == client.id, SuspensionLog.reactivated_at == None)
            .order_by(SuspensionLog.suspended_at.desc())
            .first()
        )
        if log:
            log.reactivated_at = datetime.now()
            log.user_id = current_user.id
            
        # Disparar SMS de notificación (no bloqueante)
        try:
            send_suspension_notification(client.name, client.phone, is_suspension=False)
        except Exception as notification_error:
            logger.warning(f"Error al enviar notificación de reactivación por pago: {notification_error}")
            
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/today")
def get_daily_cash(
    db: DBSession,
    _: AdminOrTechnician
):
    """
    Retorna el resumen financiero de la caja del día actual (pagos recibidos hoy).
    """
    today_start = datetime.combine(datetime.now().date(), time.min)
    today_end = datetime.combine(datetime.now().date(), time.max)
    
    # Consultar transacciones del día
    payments = (
        db.query(ClientPayment)
        .filter(ClientPayment.payment_date >= today_start, ClientPayment.payment_date <= today_end)
        .all()
    )

    # Desglose de totales por método
    total_collected = 0.0
    totals_by_method = {
        "cash": 0.0,
        "transfer": 0.0,
        "card": 0.0,
        "deposit": 0.0
    }

    serialized_payments = []
    for p in payments:
        amount = float(p.amount)
        total_collected += amount
        method = p.method.lower()
        if method in totals_by_method:
            totals_by_method[method] += amount
        else:
            totals_by_method[method] = totals_by_method.get(method, 0.0) + amount

        # Serializar manualmente para incluir computed fields
        serialized_payments.append(PaymentResponse.model_validate(p))

    return {
        "total_collected": total_collected,
        "breakdown": totals_by_method,
        "transactions": serialized_payments
    }


@router.get("/{payment_id}/receipt")
def get_payment_receipt(
    payment_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician
):
    """
    Genera y sirve para descarga el recibo en formato PDF del pago proporcionado.
    """
    payment = db.get(ClientPayment, payment_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pago no encontrado"
        )
        
    # Cargar datos de la empresa para personalizar el PDF
    company = db.query(Company).first()
    
    try:
        pdf_buffer = generate_receipt_pdf(payment, company)
        filename = f"recibo_{str(payment.id)[:8].upper()}.pdf"
        return Response(
            content=pdf_buffer.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
    except Exception as e:
        logger.error(f"Fallo al generar PDF del recibo: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al generar el recibo en PDF: {str(e)}"
        )
