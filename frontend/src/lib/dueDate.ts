/**
 * Sugerencia de fecha de vencimiento para facturas, replicando la misma lógica que
 * `resolve_due_date` en el backend (app/services/billing_cycle.py), para que el
 * valor por defecto que se propone al crear una factura MANUAL coincida con el que
 * usaría la facturación automática — sin impedir que el usuario elija otra fecha.
 */
export interface BillingDueDateSettings {
  billing_due_mode: 'fixed_term' | 'cutoff_date' | string
  billing_due_time: 'start_of_day' | 'end_of_day' | string
  billing_default_grace_days: number
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

/**
 * `issueDate`: fecha/hora de emisión (normalmente "ahora").
 * `clientCutoffDay`: día de corte del cliente (billing_period_start_day); null si no aplica o se desconoce.
 * Devuelve solo la parte de fecha (sin hora) — la hora la resuelve `resolveDueDateTime`.
 */
export function computeSuggestedDueDate(
  issueDate: Date,
  clientCutoffDay: number | null | undefined,
  settings: BillingDueDateSettings | undefined
): Date {
  if (!settings) {
    const fallback = new Date(issueDate)
    fallback.setDate(fallback.getDate() + 10)
    return fallback
  }

  let due: Date
  if (settings.billing_due_mode === 'cutoff_date') {
    const cutoffDay = clientCutoffDay || issueDate.getDate()
    const y = issueDate.getFullYear()
    const m = issueDate.getMonth()
    due = new Date(y, m, Math.min(cutoffDay, lastDayOfMonth(y, m)))
    if (due < issueDate) {
      const nextMonth = m + 1
      due = new Date(y, nextMonth, Math.min(cutoffDay, lastDayOfMonth(y, nextMonth)))
    }
  } else {
    due = new Date(issueDate)
    due.setDate(due.getDate() + (settings.billing_default_grace_days ?? 10))
  }

  // Resguardo: nunca antes que la emisión.
  if (due < issueDate) due = new Date(issueDate)
  return due
}

/** Hora a aplicar al vencimiento según Ajustes ("start_of_day" / "end_of_day"). */
export function resolveDueTimeSuffix(settings: BillingDueDateSettings | undefined): string {
  return settings?.billing_due_time === 'start_of_day' ? 'T00:00:00' : 'T23:59:59'
}

/** Formatea una fecha como "AAAA-MM-DD" para un <input type="date">. */
export function formatDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
