"""
Tests para la lógica de desglose del recibo en PDF (resolve_invoice_line_items):
el Subtotal + IVA mostrado siempre debe cuadrar con el monto real de la factura,
incluso cuando el ítem no es una mensualidad estándar (factura de ajuste por
cambio de plan, factura manual, o precios de catálogo que cambiaron después de
facturar).
"""
from types import SimpleNamespace

from app.services.pdf_generator import resolve_invoice_line_items


def _plan(price, name="Plan Fibra 20M"):
    return SimpleNamespace(name=name, price=price)


def _invoice(period="09/2026", amount=0.0, plan=None, custom_services=None, concept=None):
    return SimpleNamespace(
        period=period, amount=amount, plan=plan,
        custom_services=custom_services or [], concept=concept,
    )


def _client(custom_services=None):
    return SimpleNamespace(custom_services=custom_services or [])


def test_normal_monthly_invoice_itemizes_and_matches_total():
    plan = _plan(25.00)
    invoice = _invoice(amount=25.00, plan=plan)

    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        invoice, _client(), payment_amount=25.00, fiscal_tax_rate=0.0, billing_price_mode="included"
    )

    assert items == [("Plan de Internet: Plan Fibra 20M", 25.00)]
    assert round(subtotal + total_tax, 2) == 25.00
    assert total_items_amount == 25.00


def test_plan_plus_custom_service_matches_total():
    plan = _plan(24.99)
    cs = SimpleNamespace(name="IP Publica", price=49.99)
    invoice = _invoice(amount=74.98, plan=plan, custom_services=[cs])

    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        invoice, _client(), payment_amount=74.98, fiscal_tax_rate=15.0, billing_price_mode="included"
    )

    assert len(items) == 2
    assert round(subtotal, 2) == 65.20
    assert round(total_tax, 2) == 9.78
    assert round(total_items_amount, 2) == 74.98


def test_plan_change_adjustment_invoice_uses_invoice_amount_not_live_plan_price():
    """
    Reproduce el bug reportado: una factura de AJUSTE por cambio de plan (monto
    pequeño, $2.76) tiene `plan_id` seteado al plan nuevo (precio actual $24.99) y
    el cliente tiene un servicio adicional vigente ($49.99). Antes, el recibo
    ignoraba el monto real de la factura y mostraba el plan+servicio completos
    del cliente ($65.20 + $9.78 = $74.98) mientras "Total Recibido" mostraba el
    monto real pagado ($2.76) — un desglose que no tenía nada que ver con lo
    facturado. Debe usar el monto real de la factura ($2.76) en su lugar.
    """
    plan = _plan(24.99, name="Plan Fibra 50M")
    cs = SimpleNamespace(name="IP Publica", price=49.99)
    adjustment_invoice = _invoice(
        amount=2.76, plan=plan, custom_services=[],
        concept="Ajuste por cambio de plan: Plan Básico → Plan Fibra 50M (2 de 30 días restantes del periodo actual)",
    )
    client = _client(custom_services=[cs])

    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        adjustment_invoice, client, payment_amount=2.76, fiscal_tax_rate=15.0, billing_price_mode="included"
    )

    assert len(items) == 1
    assert items[0][0] == adjustment_invoice.concept
    assert items[0][1] == 2.76
    assert round(subtotal + total_tax, 2) == 2.76
    assert total_items_amount == 2.76


def test_manual_invoice_without_plan_uses_concept_and_amount():
    invoice = _invoice(amount=15.00, plan=None, concept="Instalación de equipo adicional")

    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        invoice, None, payment_amount=15.00, fiscal_tax_rate=15.0, billing_price_mode="included"
    )

    assert items == [("Instalación de equipo adicional", 15.00)]
    assert round(subtotal + total_tax, 2) == 15.00


def test_no_invoice_falls_back_to_payment_amount():
    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        None, None, payment_amount=30.00, fiscal_tax_rate=15.0, billing_price_mode="included"
    )

    assert items == [("Servicio de Internet (Abono Directo)", 30.00)]
    assert subtotal == 30.00
    assert total_tax == 0.0
    assert period == "Mes en Curso"


def test_stale_plan_price_falls_back_to_invoice_amount():
    """El plan subió de precio después de facturar: el recibo no debe usar el precio nuevo."""
    plan = _plan(35.00)  # precio actual, ya subió
    invoice = _invoice(amount=25.00, plan=plan)  # lo que realmente se facturó ese mes

    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        invoice, _client(), payment_amount=25.00, fiscal_tax_rate=0.0, billing_price_mode="included"
    )

    assert items[0][1] == 25.00
    assert total_items_amount == 25.00
