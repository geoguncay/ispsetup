export function formatMoney(value: number): string {
  return `$${value.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Variación porcentual respecto al periodo anterior; null si no hay base de comparación. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

/** "hace 5 min", "hace 2 h", "hace 3 d"; cae a la fecha local pasados 30 días. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d <= 30) return `hace ${d} d`
  return new Date(iso).toLocaleDateString('es-EC')
}

/** "2026-05" → "may 26" (mes corto en español). */
export function monthLabel(label: string): string {
  const [y, m] = label.split('-').map(Number)
  if (!y || !m) return label
  const month = new Date(y, m - 1, 1).toLocaleDateString('es-EC', { month: 'short' }).replace('.', '')
  return `${month} ${String(y).slice(2)}`
}
