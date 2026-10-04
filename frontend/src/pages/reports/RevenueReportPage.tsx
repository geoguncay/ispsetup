import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Receipt, Loader2, DollarSign } from 'lucide-react'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '@/services/api'
import { RevenuePeriodModal } from './RevenuePeriodModal'
import { ExportButtons, DateRangeFilters, KpiCard, ReportHeader, TOOLTIP_STYLE } from '@/pages/ReportsPage'
import type { RevenuePeriodPoint, RevenueReport } from '@/pages/ReportsPage'

export function RevenueReportPage() {
  const [groupBy, setGroupBy] = useState<'month' | 'quarter' | 'year'>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)

  const params: Record<string, string> = { group_by: groupBy }
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo

  const { data, isLoading } = useQuery<RevenueReport>({
    queryKey: ['reports-revenue', params],
    queryFn: async () => (await api.get('/reports/revenue', { params })).data,
  })

  return (
    <div className="space-y-4">
      <ReportHeader title="Reporte de Ingresos" description="" icon={DollarSign} />
      <div className="glass-card p-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Agrupar por</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} className="input-field !py-1.5">
              <option value="month">Mes</option>
              <option value="quarter">Trimestre</option>
              <option value="year">Año</option>
            </select>
          </div>
          <DateRangeFilters dateFrom={dateFrom} dateTo={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
        </div>
        <ExportButtons reportType="revenue" params={params} />
      </div>

      {isLoading || !data ? (
        <div className="glass-card p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <KpiCard label="Total recaudado" value={`$${data.total_amount.toFixed(2)}`} icon={DollarSign} accent="text-emerald-400" />
            <KpiCard label="Pagos" value={String(data.total_payments)} icon={Receipt} />
          </div>

          <div className="glass-card relative z-10 p-4">
            <h3 className="text-sm font-semibold text-foreground">Ingresos por período</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart accessibilityLayer={false} data={data.by_period} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Monto']} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={90} cursor="pointer" onClick={(p) => setSelectedPeriod((p as unknown as RevenuePeriodPoint).label)}>
                  {data.by_period.map((p) => (
                    <Cell key={p.label} fill="#10b982" fillOpacity={selectedPeriod && selectedPeriod !== p.label ? 0.45 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-card overflow-hidden">
              <h3 className="text-sm font-semibold text-foreground p-4 pb-0">Por plan</h3>
              <table className="w-full text-sm mt-2">
                <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/50"><th className="px-4 py-2">Plan</th><th className="px-4 py-2 text-right">Monto</th><th className="px-4 py-2 text-right">Pagos</th></tr></thead>
                <tbody>
                  {data.by_plan.map((p) => (
                    <tr key={p.plan_name} className="border-b border-border/30">
                      <td className="px-4 py-2">{p.plan_name}</td>
                      <td className="px-4 py-2 text-right font-mono">${p.amount.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right">{p.payments_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="glass-card overflow-hidden">
              <h3 className="text-sm font-semibold text-foreground p-4 pb-0">Por sitio</h3>
              <table className="w-full text-sm mt-2">
                <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/50"><th className="px-4 py-2">Sitio</th><th className="px-4 py-2 text-right">Monto</th><th className="px-4 py-2 text-right">Pagos</th></tr></thead>
                <tbody>
                  {data.by_site.map((s) => (
                    <tr key={s.site_name} className="border-b border-border/30">
                      <td className="px-4 py-2">{s.site_name}</td>
                      <td className="px-4 py-2 text-right font-mono">${s.amount.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right">{s.payments_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {selectedPeriod && (
        <RevenuePeriodModal label={selectedPeriod} groupBy={groupBy} dateFrom={dateFrom} onClose={() => setSelectedPeriod(null)} />
      )}
    </div>
  )
}
