"""
Endpoints API para Invoice (Facturas)
"""
import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.orm import Session

from app.core.deps import AdminOrTecnico, AdminOnly, DBSession
from app.models.invoice import Invoice
from app.models.client import Client
from app.models.plan import Plan
from app.schemas.invoice import InvoiceResponse, InvoiceUpdate, InvoiceCreate
from app.workers.billing import generate_monthly_invoices

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.post("", response_model=InvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    db: DBSession,
    _: AdminOrTecnico
) -> Invoice:
    """
    Crea una factura de forma manual para un cliente.
    """
    # Verificar si el cliente existe
    client = db.get(Client, payload.cliente_id)
    if not client:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cliente no encontrado"
        )

    # Si se envía plan_id, verificar que exista
    if payload.plan_id:
        plan = db.get(Plan, payload.plan_id)
        if not plan:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El plan especificado no existe."
            )

    new_invoice = Invoice(
        cliente_id=payload.cliente_id,
        plan_id=payload.plan_id,
        periodo=payload.periodo,
        monto=payload.monto,
        fecha_emision=datetime.now(),
        fecha_vencimiento=payload.fecha_vencimiento,
        estado="pendiente"
    )
    db.add(new_invoice)
    db.commit()
    db.refresh(new_invoice)
    return new_invoice



@router.get("", response_model=list[InvoiceResponse])
def get_invoices(
    db: DBSession,
    _: AdminOrTecnico,
    cliente_id: uuid.UUID | None = None,
    estado: str | None = None,
    overdue: bool | None = None
) -> list[Invoice]:
    """
    Obtiene el listado de facturas. Soporta filtros de cliente, estado y vencidas.
    """
    query = db.query(Invoice)
    
    if cliente_id:
        query = query.filter(Invoice.cliente_id == cliente_id)
        
    if estado:
        if estado not in ("pendiente", "pagado", "vencido"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Estado de factura inválido. Use: 'pendiente', 'pagado', 'vencido'"
            )
        query = query.filter(Invoice.estado == estado)
        
    if overdue is not None:
        now = datetime.now()
        if overdue:
            # Facturas que pasaron su fecha de vencimiento y no están pagadas
            query = query.filter(
                Invoice.estado.in_(["pendiente", "vencido"]),
                Invoice.fecha_vencimiento < now
            )
        else:
            # Facturas no vencidas o pagadas
            query = query.filter(
                (Invoice.estado == "pagado") | (Invoice.fecha_vencimiento >= now)
            )
            
    # Ordenar por fecha de emisión más reciente primero
    return query.order_by(Invoice.fecha_emision.desc()).all()


@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: uuid.UUID,
    db: DBSession,
    _: AdminOrTecnico
) -> Invoice:
    """
    Obtiene el detalle de una factura específica por su ID.
    """
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Factura no encontrada"
        )
    return invoice


@router.post("/generate-monthly")
def trigger_monthly_billing(
    db: DBSession,
    _: AdminOnly
):
    """
    Dispara manualmente el proceso de facturación mensual para el mes en curso.
    Útil para testing y facturaciones manuales inmediatas.
    """
    result = generate_monthly_invoices()
    if result.get("status") == "error":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get("detail", "Error al generar facturas")
        )
    return result
