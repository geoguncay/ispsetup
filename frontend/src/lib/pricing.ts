/**
 * Cálculo de precio total según Ajustes > Facturación > Configuración de Facturación
 * (billing_price_mode): "included" el precio ya trae el IVA, "excluded" hay que sumarlo.
 * Debe reflejar exactamente la misma lógica que `effective_price` en el backend
 * (app/services/billing_cycle.py) para que lo mostrado en el catálogo coincida con
 * lo que realmente se factura.
 */
export interface PriceBreakdown {
  subtotal: number
  taxAmount: number
  total: number
}

export function computePriceBreakdown(price: number, taxRate: number, priceMode: string | undefined): PriceBreakdown {
  const p = Number(price) || 0
  const rate = Number(taxRate) || 0

  if (priceMode === 'excluded') {
    const taxAmount = (p * rate) / 100
    return { subtotal: p, taxAmount, total: p + taxAmount }
  }

  // "included" (default): el precio ingresado ya incluye el impuesto.
  const subtotal = rate > 0 ? p / (1 + rate / 100) : p
  return { subtotal, taxAmount: p - subtotal, total: p }
}
