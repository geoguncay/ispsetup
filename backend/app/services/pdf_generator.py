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


def generate_receipt_pdf(payment: ClientPayment, company: Company | None = None) -> BytesIO:
    """
    Genera un comprobante de pago en formato PDF y lo retorna en un buffer de bytes.
    El diseño utiliza tablas limpias, tipografía clara y un esquema de colores azul profesional.
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
    comp_name = company.nombre if company else "ISP Platform"
    comp_ruc = company.ruc if (company and company.ruc) else "0999999999001"
    comp_dir = company.direccion if (company and company.direccion) else "Guayaquil, Ecuador"
    comp_tel = company.telefono if (company and company.telefono) else "+593 99 999 9999"
    comp_email = company.email if (company and company.email) else "soporte@isp.com"
    
    # ── Encabezado (Información ISP vs Título Recibo) ──────────────────────────
    header_data = [
        [
            Paragraph(
                f"<b><font size=14 color='#1e3a8a'>{comp_name}</font></b><br/>"
                f"RUC: {comp_ruc}<br/>"
                f"Telf: {comp_tel}<br/>"
                f"Email: {comp_email}<br/>"
                f"Dirección: {comp_dir}",
                body_style
            ),
            Paragraph(
                f"<font size=22 color='#2563eb'><b>RECIBO DE PAGO</b></font><br/><br/>"
                f"<b>Nº Comprobante:</b> {str(payment.id)[:8].upper()}<br/>"
                f"<b>Fecha de Pago:</b> {payment.fecha_pago.strftime('%d/%m/%Y %H:%M')}",
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
    client_name = client.nombre if client else "N/A"
    client_cedula = client.cedula if client else "N/A"
    client_email = client.email if (client and client.email) else "N/A"
    client_tel = client.telefono if client else "N/A"
    client_dir = client.direccion if client else "N/A"
    
    client_data = [
        [
            Paragraph("<b>CLIENTE:</b>", bold_body_style),
            Paragraph(client_name, body_style),
            Paragraph("<b>CÉDULA / RUC:</b>", bold_body_style),
            Paragraph(client_cedula, body_style)
        ],
        [
            Paragraph("<b>TELÉFONO:</b>", bold_body_style),
            Paragraph(client_tel, body_style),
            Paragraph("<b>EMAIL:</b>", bold_body_style),
            Paragraph(client_email, body_style)
        ],
        [
            Paragraph("<b>DIRECCIÓN:</b>", bold_body_style),
            Paragraph(client_dir, body_style),
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

    total_subtotal = 0.0
    total_iva = 0.0
    total_items_pago = 0.0
    payment_total_recaudado = float(payment.monto)

    invoice = payment.invoice
    if invoice:
        periodo = invoice.periodo
        # 1. Plan Base
        if invoice.plan:
            plan = invoice.plan
            plan_name = f"Plan de Internet: {plan.nombre}"
            plan_total = float(plan.precio)
            plan_taxes = float(plan.impuestos) if plan.impuestos else 0.0
            plan_sub = plan_total / (1 + plan_taxes / 100) if plan_taxes > 0 else plan_total
            plan_iva = plan_total - plan_sub
            
            detail_data.append([
                Paragraph(plan_name, body_style),
                Paragraph(periodo, body_style),
                Paragraph(payment.metodo.replace("_", " ").title(), body_style),
                Paragraph(f"${plan_total:.2f}", right_align_body)
            ])
            total_subtotal += plan_sub
            total_iva += plan_iva
            total_items_pago += plan_total

        # 2. Servicios de valor agregado de la factura (con fallback al cliente para facturas antiguas)
        client = payment.client
        custom_services_to_bill = []
        if invoice.custom_services:
            custom_services_to_bill = invoice.custom_services
        elif client and client.custom_services:
            custom_services_to_bill = client.custom_services

        for cs in custom_services_to_bill:
            cs_name = f"Valor Agregado: {cs.nombre}"
            cs_total = float(cs.precio)
            cs_taxes = float(cs.impuestos) if cs.impuestos else 0.0
            cs_sub = cs_total / (1 + cs_taxes / 100) if cs_taxes > 0 else cs_total
            cs_iva = cs_total - cs_sub
            
            detail_data.append([
                Paragraph(cs_name, body_style),
                Paragraph(periodo, body_style),
                Paragraph(payment.metodo.replace("_", " ").title(), body_style),
                Paragraph(f"${cs_total:.2f}", right_align_body)
            ])
            total_subtotal += cs_sub
            total_iva += cs_iva
            total_items_pago += cs_total

        # Caso especial: factura manual o sin plan ni servicios asociados pero con monto directo
        if total_items_pago == 0.0:
            total_items_pago = payment_total_recaudado
            total_subtotal = total_items_pago
            total_iva = 0.0
            detail_data.append([
                Paragraph("Servicio de Internet (Monto Manual)", body_style),
                Paragraph(periodo, body_style),
                Paragraph(payment.metodo.replace("_", " ").title(), body_style),
                Paragraph(f"${payment_total_recaudado:.2f}", right_align_body)
            ])
    else:
        # Fallback si no hay factura asociada
        periodo = "Mes en Curso"
        total_items_pago = payment_total_recaudado
        total_subtotal = total_items_pago
        total_iva = 0.0
        
        detail_data.append([
            Paragraph("Servicio de Internet (Abono Directo)", body_style),
            Paragraph(periodo, body_style),
            Paragraph(payment.metodo.replace("_", " ").title(), body_style),
            Paragraph(f"${payment_total_recaudado:.2f}", right_align_body)
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
            Paragraph(f"${total_subtotal:.2f}", right_align_body)
        ],
        [
            Paragraph("", body_style),
            Paragraph("IVA:", right_align_body),
            Paragraph(f"${total_iva:.2f}", right_align_body)
        ],
        [
            Paragraph("", body_style),
            Paragraph("<b>Total Recibido:</b>", right_align_bold),
            Paragraph(f"<b>${payment_total_recaudado:.2f}</b>", right_align_bold)
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
    if payment.notas:
        story.append(Spacer(1, 15))
        notes_box = Table([
            [Paragraph(f"<b>Notas / Referencia:</b> {payment.notas}", body_style)]
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
        "Generado automáticamente por el portal administrativo de ISP Platform."
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
