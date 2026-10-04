import { useQuery } from '@tanstack/react-query'
import { Receipt, Users, AlertTriangle, Loader2, TrendingUp } from 'lucide-react'
import api from '@/services/api'
import { ExportButtons, KpiCard, ReportHeader } from '@/pages/ReportsPage'
import type { OverdueReport } from '@/pages/ReportsPage'

export function OverdueReportPage() {
  const { data, isLoading } = useQuery<OverdueReport>({
    queryKey: ['reports-overdue'],
    queryFn: async () => (await api.get('/reports/overdue')).data,
  })

  return (
    <div className="space-y-4">
      <ReportHeader title="Reporte de Mora" description="" icon={AlertTriangle} />
      <div className="flex justify-end"><ExportButtons reportType="overdue" params={{}} /></div>

      {isLoading || !data ? (
        <div className="glass-card p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Clientes en mora" value={String(data.total_clients)} icon={Users} accent="text-red-400" />
            <KpiCard label="Facturas vencidas" value={String(data.total_invoices)} icon={Receipt} accent="text-red-400" />
            <KpiCard label="Monto total" value={`$${data.total_amount.toFixed(2)}`} icon={TrendingUp} accent="text-red-400" />
          </div>
          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/50">
                  <th className="px-4 py-2">Cliente</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Período</th>
                  <th className="px-4 py-2">Vencimiento</th><th className="px-4 py-2 text-right">Días mora</th><th className="px-4 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.invoice_id} className="border-b border-border/30">
                    <td className="px-4 py-2">{i.client_name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{i.plan_name ?? '—'}</td>
                    <td className="px-4 py-2">{i.period}</td>
                    <td className="px-4 py-2">{new Date(i.due_date).toLocaleDateString('es-EC')}</td>
                    <td className="px-4 py-2 text-right text-red-400 font-semibold">{i.days_overdue}</td>
                    <td className="px-4 py-2 text-right font-mono">${i.amount.toFixed(2)}</td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Sin facturas en mora. 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
