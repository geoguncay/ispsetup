"""
Endpoints API para Invoice (Facturas)
"""
import re
import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status as http_status, Depends
from sqlalchemy.orm import Session

from app.core.deps import AdminOrTechnician, AdminOnly, DBSession
from app.models.invoice import Invoice
from app.models.client import Client
from app.models.plan import Plan
from app.schemas.invoice import InvoiceEdit, InvoiceResponse, InvoiceUpdate, InvoiceCreate
from app.workers.billing import generate_monthly_invoices
from app.services.audit_service import AuditAction, audit_detail, changed_fields, log_event

PERIOD_PATTERN = r"^(0[1-9]|1[0-2])/\d{4}$"

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _strip_tz(dt: datetime) -> datetime:
    """Normaliza a naive-UTC para poder comparar sin importar si `dt` trae zona horaria o no."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@router.post("", response_model=InvoiceResponse, status_code=http_status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    db: DBSession,
    current_user: AdminOrTechnician
) -> Invoice:
    """
    Crea una factura de forma manual para un cliente.
    """
    # Verificar si el cliente existe
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Cliente no encontrado"
        )

    # Si se envía plan_id, verificar que exista
    if payload.plan_id:
        plan = db.get(Plan, payload.plan_id)
        if not plan:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="El plan especificado no existe."
            )

    issue_date = datetime.now()
    if _strip_tz(payload.due_date) < _strip_tz(issue_date):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="La fecha de vencimiento no puede ser anterior a la fecha de emisión de la factura.",
        )

    new_invoice = Invoice(
        client_id=payload.client_id,
        plan_id=payload.plan_id,
        period=payload.period,
        amount=payload.amount,
        concept=payload.concept,
        issue_date=issue_date,
        due_date=payload.due_date,
        status="pending"
    )
    db.add(new_invoice)
    db.commit()
    db.refresh(new_invoice)
    log_event(
        db, AuditAction.CREATE_INVOICE,
        entity_type="Invoice", entity_id=new_invoice.id,
        entity_name=f"Factura {new_invoice.period} · {client.full_name}",
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail(
            "Factura manual creada", client=client.full_name, period=new_invoice.period,
            amount=new_invoice.amount, due_date=new_invoice.due_date,
        ),
    )
    return new_invoice



@router.get("", response_model=list[InvoiceResponse])
def get_invoices(
    db: DBSession,
    _: AdminOrTechnician,
    client_id: uuid.UUID | None = None,
    status: str | None = None,
    overdue: bool | None = None
) -> list[Invoice]:
    """
    Obtiene el listado de facturas. Soporta filtros de cliente, estado y vencidas.
    """
    query = db.query(Invoice)

    if client_id:
        query = query.filter(Invoice.client_id == client_id)

    if status:
        if status not in ("pending", "paid", "overdue", "cancelled"):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Estado de factura inválido. Use: 'pending', 'paid', 'overdue', 'cancelled'"
            )
        query = query.filter(Invoice.status == status)

    if overdue is not None:
        now = datetime.now()
        if overdue:
            # Facturas que pasaron su fecha de vencimiento y no están pagadas
            query = query.filter(
                Invoice.status.in_(["pending", "overdue"]),
                Invoice.due_date < now
            )
        else:
            # Facturas no vencidas o pagadas
            query = query.filter(
                (Invoice.status == "paid") | (Invoice.due_date >= now)
            )

    # Ordenar por fecha de emisión más reciente primero
    return query.order_by(Invoice.issue_date.desc()).all()


@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTechnician
) -> Invoice:
    """
    Obtiene el detalle de una factura específica por su ID.
    """
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return invoice


@router.post("/{invoice_id}/void", response_model=InvoiceResponse)
def void_invoice(
    invoice_id: uuid.UUID,
    db: DBSession,
    current_user: AdminOnly,
) -> Invoice:
    """
    Anula una factura YA PAGADA: el registro queda (auditoría/historial) pero pasa
    a estado "cancelled" y deja de contar en totales facturados. El/los pagos
    asociados también se anulan (status "cancelled"), así dejan de contar en
    Caja/Recaudado — no puede quedar dinero "cobrado" sobre una factura anulada.

    Las facturas pendientes o vencidas (sin pagar) no se anulan: se editan o se
    eliminan directamente (ver PUT y DELETE de este mismo recurso).
    """
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Factura no encontrada")

    if invoice.status == "cancelled":
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="La factura ya está anulada.")
    if invoice.status != "paid":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Solo se pueden anular facturas pagadas. Las pendientes o vencidas se editan o se eliminan.",
        )

    invoice.status = "cancelled"
    cancelled_payment_ids = []
    for payment in invoice.payments:
        if payment.status != "cancelled":
            payment.status = "cancelled"
            cancelled_payment_ids.append(str(payment.id))
    db.commit()
    db.refresh(invoice)

    log_event(
        db, AuditAction.VOID_INVOICE,
        entity_type="Invoice", entity_id=invoice.id,
        entity_name=f"Factura {invoice.period} · {invoice.client.full_name if invoice.client else ''}",
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail(
            "Factura anulada", period=invoice.period, amount=invoice.amount,
            cancelled_payment_ids=cancelled_payment_ids,
        ),
    )
    return invoice


@router.put("/{invoice_id}", response_model=InvoiceResponse)
def edit_invoice(
    invoice_id: uuid.UUID,
    payload: InvoiceEdit,
    db: DBSession,
    current_user: AdminOrTechnician,
) -> Invoice:
    """
    Edita una factura pendiente o vencida (todavía sin ningún pago). No aplica a
    facturas pagadas o ya anuladas.
    """
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Factura no encontrada")

    if invoice.status not in ("pending", "overdue"):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Solo se pueden editar facturas pendientes o vencidas.",
        )

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="No se envió ningún cambio.")

    if "period" in update_data and not re.match(PERIOD_PATTERN, update_data["period"]):
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="El periodo debe tener el formato MM/AAAA.")

    new_due_date = update_data.get("due_date", invoice.due_date)
    if _strip_tz(new_due_date) < _strip_tz(invoice.issue_date):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="La fecha de vencimiento no puede ser anterior a la fecha de emisión de la factura.",
        )

    before = {field: getattr(invoice, field) for field in update_data}
    for field, value in update_data.items():
        setattr(invoice, field, value)

    # Si el vencimiento se corrigió hacia el futuro, una factura ya marcada
    # "vencida" vuelve a quedar "pendiente".
    if invoice.status == "overdue" and _strip_tz(invoice.due_date) >= _strip_tz(datetime.now()):
        invoice.status = "pending"

    db.commit()
    db.refresh(invoice)

    log_event(
        db, AuditAction.UPDATE_INVOICE,
        entity_type="Invoice", entity_id=invoice.id,
        entity_name=f"Factura {invoice.period} · {invoice.client.full_name if invoice.client else ''}",
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail(
            "Factura editada",
            changes=changed_fields(before, {field: getattr(invoice, field) for field in update_data}),
        ),
    )
    return invoice


@router.delete("/{invoice_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: uuid.UUID,
    db: DBSession,
    current_user: AdminOnly,
) -> None:
    """
    Elimina definitivamente una factura pendiente o vencida. No se permite si
    tiene algún pago asociado (facturas pagadas o ya anuladas se preservan por
    auditoría; una factura pagada se anula, no se elimina).
    """
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Factura no encontrada")

    if invoice.status not in ("pending", "overdue") or invoice.payments:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Solo se pueden eliminar facturas pendientes o vencidas sin pagos asociados.",
        )

    period = invoice.period
    amount = invoice.amount
    client_name = invoice.client.full_name if invoice.client else ""
    db.delete(invoice)
    db.commit()

    log_event(
        db, AuditAction.DELETE_INVOICE,
        entity_type="Invoice", entity_id=invoice_id,
        entity_name=f"Factura {period} · {client_name}",
        user_id=current_user.id, user_name=current_user.name,
        detail=audit_detail("Factura eliminada", period=period, amount=amount),
    )


@router.post("/generate-monthly")
def trigger_monthly_billing(
    db: DBSession,
    current_user: AdminOnly
):
    """
    Dispara manualmente el proceso de facturación mensual para el mes en curso.
    Útil para testing y facturaciones manuales inmediatas.
    """
    result = generate_monthly_invoices(
        force=True, audit_user_id=str(current_user.id), audit_user_name=current_user.name
    )
    if result.get("status") == "error":
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get("detail", "Error al generar facturas")
        )
    return result
