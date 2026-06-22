"""
Endpoints API para ClientPayment (Pagos)
"""
import uuid
import logging
from datetime import datetime, time
from fastapi import APIRouter, HTTPException, status, Depends, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import AdminOrTecnico, DBSession, CurrentUser
from app.models.payment import ClientPayment
from app.models.invoice import Invoice
from app.models.client import Client
from app.models.client_plan import ClientPlan
from app.models.suspension_log import SuspensionLog
from app.models.company import Company
from app.schemas.payment import PaymentCreate, PaymentResponse
from app.core.security import decrypt_secret
from app.services.mikrotik.pppoe import sync_pppoe_secret_in_router
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
        
    if invoice.estado == "pagado":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La factura ya se encuentra pagada"
        )
        
    # 1. Marcar la factura como pagada
    invoice.estado = "pagado"
    
    # 2. Registrar el pago
    payment = ClientPayment(
        cliente_id=invoice.cliente_id,
        invoice_id=invoice.id,
        monto=payment_in.monto,
        metodo=payment_in.metodo,
        estado="completado",
        notas=payment_in.notas,
        usuario_id=current_user.id
    )
    db.add(payment)
    
    client = invoice.client
    
    # 3. Reactivar cliente si estaba inactivo/suspendido
    if not client.activo:
        logger.info(f"Detectado cliente suspendido {client.nombre} ({client.id}). Procediendo a reactivación...")
        client.activo = True
        
        # Activar su plan suspendido
        suspended_plan = (
            db.query(ClientPlan)
            .filter(ClientPlan.cliente_id == client.id, ClientPlan.estado == "suspendido")
            .first()
        )
        if suspended_plan:
            suspended_plan.estado = "activo"
            
        # Reactivar en MikroTik
        if client.tipo == "static" and client.static_ip:
            try:
                unsuspend_ip_in_firewall(client.router, client.static_ip.ip)
                toggle_client_queue(client.router, client.static_ip.ip, disabled=False)
            except Exception as e:
                db.rollback()
                logger.error(f"Fallo al reactivar en MikroTik para IP Estática: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Pago registrado pero falló la reactivación en MikroTik: {str(e)}"
                )
        elif client.tipo == "pppoe" and client.pppoe_secret:
            try:
                password_dec = decrypt_secret(client.pppoe_secret.contraseña_ppp)
                profile_name = client.pppoe_secret.perfil.nombre if client.pppoe_secret.perfil else "default"
                sync_pppoe_secret_in_router(
                    router=client.router,
                    username=client.pppoe_secret.usuario_ppp,
                    password=password_dec,
                    profile_name=profile_name,
                    client_name=client.nombre,
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
            .filter(SuspensionLog.cliente_id == client.id, SuspensionLog.fecha_reactivacion == None)
            .order_by(SuspensionLog.fecha_suspension.desc())
            .first()
        )
        if log:
            log.fecha_reactivacion = datetime.now()
            log.usuario_id = current_user.id
            
        # Disparar SMS de notificación (no bloqueante)
        try:
            send_suspension_notification(client.nombre, client.telefono, is_suspension=False)
        except Exception as notification_error:
            logger.warning(f"Error al enviar notificación de reactivación por pago: {notification_error}")
            
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/today")
def get_daily_cash(
    db: DBSession,
    _: AdminOrTecnico
):
    """
    Retorna el resumen financiero de la caja del día actual (pagos recibidos hoy).
    """
    today_start = datetime.combine(datetime.now().date(), time.min)
    today_end = datetime.combine(datetime.now().date(), time.max)
    
    # Consultar transacciones del día
    payments = (
        db.query(ClientPayment)
        .filter(ClientPayment.fecha_pago >= today_start, ClientPayment.fecha_pago <= today_end)
        .all()
    )
    
    # Desglose de totales por método
    total_cobrado = 0.0
    totals_by_method = {
        "efectivo": 0.0,
        "transferencia": 0.0,
        "tarjeta": 0.0,
        "deposito": 0.0
    }
    
    serialized_payments = []
    for p in payments:
        monto = float(p.monto)
        total_cobrado += monto
        metodo = p.metodo.lower()
        if metodo in totals_by_method:
            totals_by_method[metodo] += monto
        else:
            totals_by_method[metodo] = totals_by_method.get(metodo, 0.0) + monto
            
        # Serializar manualmente para incluir computed fields
        serialized_payments.append(PaymentResponse.model_validate(p))
        
    return {
        "total_cobrado": total_cobrado,
        "desglose": totals_by_method,
        "transacciones": serialized_payments
    }


@router.get("/{payment_id}/receipt")
def get_payment_receipt(
    payment_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTecnico
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
