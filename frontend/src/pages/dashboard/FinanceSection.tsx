import { AlertTriangle, CalendarDays, Receipt, Wallet } from 'lucide-react'
import { SectionTitle, StatCard } from './StatCard'
import { formatMoney, percentChange } from './format'
import type { FinanceSummary } from './types'

export function FinanceSection({ finance }: { finance: FinanceSummary }) {
  const change = percentChange(finance.collected_month, finance.collected_previous_month)
  const monthHint =
    change === null
      ? 'Sin datos del mes anterior'
      : `${change >= 0 ? '+' : ''}${change.toFixed(0)}% vs mes anterior`

  return (
    <section>
      <SectionTitle>Finanzas</SectionTitle>
      <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Cobrado hoy" value={formatMoney(finance.collected_today)} icon={Wallet} tone="emerald" to="/payments" />
        <StatCard
          label="Cobrado en el mes"
          value={formatMoney(finance.collected_month)}
          icon={CalendarDays}
          tone="brand"
          hint={monthHint}
          to="/reports/revenue"
        />
        <StatCard
          label="Por cobrar"
          value={formatMoney(finance.pending_amount)}
          icon={Receipt}
          tone="sky"
          hint={`${finance.pending_invoices} facturas pendientes`}
          to="/invoices"
        />
        <StatCard
          label="En mora"
          value={formatMoney(finance.overdue_amount)}
          icon={AlertTriangle}
          tone={finance.overdue_invoices > 0 ? 'red' : 'slate'}
          hint={`${finance.overdue_clients} clientes · ${finance.overdue_invoices} facturas`}
          to="/reports/overdue"
        />
      </div>
    </section>
  )
}
