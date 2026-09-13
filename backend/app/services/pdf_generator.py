"""
Servicio para generar comprobantes de pago en PDF utilizando ReportLab.
"""
from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from app.models.payment import ClientPayment
from app.models.company import Company
from app.models.client import Client
from app.models.invoice import Invoice
from app.services.billing_cycle import effective_price


def resolve_invoice_line_items(
    invoice: Invoice | None,
    client: Client | None,
    payment_amount: float,
    fiscal_tax_rate: float,
    billing_price_mode: str,
) -> tuple[list[tuple[str, float]], float, float, float, str]:
    """
    Decide qué líneas mostrar en el recibo y su desglose de IVA. Devuelve
    (items, subtotal, total_tax, total_items_amount, period).

    Reconstruye plan + servicios con el precio ACTUAL del catálogo (vía
    `effective_price`) y los usa como desglose por ítem SOLO si su suma coincide
    con `invoice.amount` — el caso normal de una factura mensual recién generada.
    Si no coincide (factura de ajuste por cambio de plan, factura manual con
    monto propio, o el precio del plan/servicio cambió después de facturar), el
    desglose por ítem ya no representa lo realmente facturado: se reemplaza por
    una sola línea con el monto real de la factura (`invoice.amount`), para que
    Subtotal + IVA siempre cuadre con lo que efectivamente se cobró.
    """
    if not invoice:
        return ([("Servicio de Internet (Abono Directo)", payment_amount)], payment_amount, 0.0, payment_amount, "Mes en Curso")

    period = invoice.period
    invoice_amount = float(invoice.amount)
    tax_rate = fiscal_tax_rate or 0.0

    def _split(total: float) -> tuple[float, float]:
        subtotal = total / (1 + tax_rate / 100) if tax_rate > 0 else total
        return subtotal, total - subtotal

    candidate_items: list[tuple[str, float]] = []
    candidate_subtotal = 0.0
    candidate_tax = 0.0
    candidate_total = 0.0

    if invoice.plan:
        plan_total = effective_price(invoice.plan.price, tax_rate, billing_price_mode)
        plan_subtotal, plan_tax = _split(plan_total)
        candidate_items.append((f"Plan de Internet: {invoice.plan.name}", plan_total))
        candidate_subtotal += plan_subtotal
        candidate_tax += plan_tax
        candidate_total += plan_total

    custom_services_to_bill = []
    if invoice.custom_services:
        custom_services_to_bill = invoice.custom_services
    elif client and client.custom_services:
        custom_services_to_bill = client.custom_services

    for cs in custom_services_to_bill:
        cs_total = effective_price(cs.price, tax_rate, billing_price_mode)
        cs_subtotal, cs_tax = _split(cs_total)
        candidate_items.append((f"Valor Agregado: {cs.name}", cs_total))
        candidate_subtotal += cs_subtotal
        candidate_tax += cs_tax
        candidate_total += cs_total

    if candidate_items and abs(candidate_total - invoice_amount) < 0.01:
        return (candidate_items, candidate_subtotal, candidate_tax, candidate_total, period)

    if invoice_amount > 0:
        description = invoice.concept or (
            f"Plan de Internet: {invoice.plan.name}" if invoice.plan else "Servicio de Internet"
        )
        invoice_subtotal, invoice_tax = _split(invoice_amount)
        return ([(description, invoice_amount)], invoice_subtotal, invoice_tax, invoice_amount, period)

    # Sin ítems reconstruibles y sin monto de factura utilizable (p. ej. una nota de
    # crédito con monto negativo): usar lo efectivamente pagado como último recurso.
    return ([("Servicio de Internet (Monto Manual)", payment_amount)], payment_amount, 0.0, payment_amount, period)


def generate_receipt_pdf(
    payment: ClientPayment, company: Company | None = None, fiscal_tax_rate: float = 0.0,
    billing_price_mode: str = "included",
) -> BytesIO:
    """
    Genera un comprobante de pago en formato PDF y lo retorna en un buffer de bytes.
    El diseño utiliza tablas limpias, tipografía clara y un esquema de colores azul profesional.

    `fiscal_tax_rate` es la tasa de IVA global (Ajustes > Facturación > Fiscal), usada para
    desglosar subtotal/impuesto tanto del plan como de los servicios personalizados
    (ninguno de los dos tiene ya una tasa propia).

    `billing_price_mode` (Ajustes > Facturación > Configuración de Facturación) define cómo
    se interpreta el precio guardado: "included" — el precio ya trae el impuesto, el subtotal
    se obtiene dividiendo — o "excluded" — el precio es la base sin impuesto, que se suma aparte.
    """
    buffer = BytesIO()
    
    # Configurar el documento con márgenes de 40pt (~1.4 cm)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40
    )
    
    story = []
    
    # Obtener el conjunto de estilos por defecto
    styles = getSampleStyleSheet()
    
    # Definir estilos personalizados
    body_style = ParagraphStyle(
        name='ReceiptBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        textColor=colors.HexColor('#374151'),  # Gris pizarra
        leading=14
    )
    
    bold_body_style = ParagraphStyle(
        name='ReceiptBodyBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        textColor=colors.HexColor('#111827'),  # Gris oscuro
        leading=14
    )
    
    right_align_body = ParagraphStyle(
        name='ReceiptRightBody',
        parent=body_style,
        alignment=2  # Derecha
    )
    
    right_align_bold = ParagraphStyle(
        name='ReceiptRightBold',
        parent=bold_body_style,
        alignment=2  # Derecha
    )
    
    # Resolver datos de la empresa o usar defaults del sistema
    company_name = company.name if company else "ISP SETUP"
    company_ruc = company.ruc if (company and company.ruc) else "0999999999001"
    company_address = company.address if (company and company.address) else "Guayaquil, Ecuador"
    company_phone = company.phone if (company and company.phone) else "+593 99 999 9999"
    company_email = company.email if (company and company.email) else "soporte@isp.com"
    
    # ── Encabezado (Información ISP vs Título Recibo) ──────────────────────────
    header_data = [
        [
            Paragraph(
                f"<b><font size=14 color='#1e3a8a'>{company_name}</font></b><br/>"
                f"RUC: {company_ruc}<br/>"
                f"Telf: {company_phone}<br/>"
                f"Email: {company_email}<br/>"
                f"Dirección: {company_address}",
                body_style
            ),
            Paragraph(
                f"<font size=22 color='#2563eb'><b>RECIBO DE PAGO</b></font><br/><br/>"
                f"<b>Nº Comprobante:</b> {str(payment.id)[:8].upper()}<br/>"
                f"<b>Fecha de Pago:</b> {payment.payment_date.strftime('%d/%m/%Y %H:%M')}",
                right_align_body
            )
        ]
    ]
    
    header_table = Table(header_data, colWidths=[290, 240])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(header_table)
    
    # Línea divisoria
    story.append(Spacer(1, 5))
    divider = Table([[""]], colWidths=[530])
    divider.setStyle(TableStyle([
        ('LINEBELOW', (0,0), (-1,-1), 1.5, colors.HexColor('#e5e7eb')),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(divider)
    story.append(Spacer(1, 15))
    
    # ── Datos del Cliente ──────────────────────────────────────────────────────
    client = payment.client
    client_name = client.full_name if client else "N/A"
    client_cedula = client.cedula if client else "N/A"
    client_email = client.email if (client and client.email) else "N/A"
    client_phone = client.phone if client else "N/A"
    client_address = client.address if client else "N/A"
    
    client_data = [
        [
            Paragraph("<b>CLIENTE:</b>", bold_body_style),
            Paragraph(client_name, body_style),
            Paragraph("<b>CÉDULA / RUC:</b>", bold_body_style),
            Paragraph(client_cedula, body_style)
        ],
        [
            Paragraph("<b>TELÉFONO:</b>", bold_body_style),
            Paragraph(client_phone, body_style),
            Paragraph("<b>EMAIL:</b>", bold_body_style),
            Paragraph(client_email, body_style)
        ],
        [
            Paragraph("<b>DIRECCIÓN:</b>", bold_body_style),
            Paragraph(client_address, body_style),
            Paragraph("", body_style),
            Paragraph("", body_style)
        ]
    ]
    
    client_table = Table(client_data, colWidths=[80, 185, 95, 170])
    client_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(client_table)
    
    story.append(Spacer(1, 15))
    
    # ── Detalles Financieros de la Transacción ─────────────────────────────────
    detail_data = [
        [
            Paragraph("<b>Descripción del Concepto</b>", bold_body_style),
            Paragraph("<b>Periodo</b>", bold_body_style),
            Paragraph("<b>Forma de Pago</b>", bold_body_style),
            Paragraph("<b>Monto</b>", right_align_bold)
        ]
    ]

    payment_amount = float(payment.amount)

    items, subtotal, total_tax, total_items_amount, period = resolve_invoice_line_items(
        payment.invoice, payment.client, payment_amount, fiscal_tax_rate, billing_price_mode
    )
    for description, item_amount in items:
        detail_data.append([
            Paragraph(description, body_style),
            Paragraph(period, body_style),
            Paragraph(payment.method.replace("_", " ").title(), body_style),
            Paragraph(f"${item_amount:.2f}", right_align_body)
        ])

    table_styles = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f9fafb')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('LINEBELOW', (0,0), (-1,0), 1, colors.HexColor('#e5e7eb')),
    ]
    for idx in range(1, len(detail_data)):
        table_styles.append(('LINEBELOW', (0, idx), (-1, idx), 1, colors.HexColor('#f3f4f6')))

    detail_table = Table(detail_data, colWidths=[230, 100, 100, 100])
    detail_table.setStyle(TableStyle(table_styles))
    story.append(detail_table)
    
    story.append(Spacer(1, 12))
    
    # ── Totales y Desglose ─────────────────────────────────────────────────────
    summary_data = [
        [
            Paragraph("", body_style),
            Paragraph("Subtotal:", right_align_body),
            Paragraph(f"${subtotal:.2f}", right_align_body)
        ],
        [
            Paragraph("", body_style),
            Paragraph("IVA:", right_align_body),
            Paragraph(f"${total_tax:.2f}", right_align_body)
        ],
        [
            Paragraph("", body_style),
            Paragraph("<b>Total Recibido:</b>", right_align_bold),
            Paragraph(f"<b>${payment_amount:.2f}</b>", right_align_bold)
        ]
    ]
    
    summary_table = Table(summary_data, colWidths=[310, 110, 110])
    summary_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(summary_table)
    
    # ── Notas / Comentarios ────────────────────────────────────────────────────
    if payment.notes:
        story.append(Spacer(1, 15))
        notes_box = Table([
            [Paragraph(f"<b>Notas / Referencia:</b> {payment.notes}", body_style)]
        ], colWidths=[530])
        notes_box.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f3f4f6')),
            ('PADDING', (0,0), (-1,-1), 8),
            ('LINELEFT', (0,0), (-1,-1), 3, colors.HexColor('#2563eb')),
        ]))
        story.append(notes_box)
        
    # ── Pie de Página ──────────────────────────────────────────────────────────
    story.append(Spacer(1, 50))
    footer_text = (
        "<font color='#9ca3af' size=8>"
        "Este documento constituye un comprobante de recibo electrónico de fondos. "
        "Gracias por mantener sus pagos al día.<br/>"
        "Generado automáticamente por el portal administrativo de ISP SETUP."
        "</font>"
    )
    footer_table = Table([[Paragraph(footer_text, body_style)]], colWidths=[530])
    footer_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(footer_table)
    
    # Compilar PDF en el buffer
    doc.build(story)
    buffer.seek(0)
    return buffer
