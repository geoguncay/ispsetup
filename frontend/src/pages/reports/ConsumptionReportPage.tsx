import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Loader2, Clock } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '@/services/api'
import { formatVolume } from '@/lib/traffic'
import { ExportButtons, DateRangeFilters, ReportHeader, TOOLTIP_STYLE } from '@/pages/ReportsPage'
import type { ConsumptionReport } from '@/pages/ReportsPage'

export function ConsumptionReportPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const params: Record<string, string> = {}
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo

  const { data, isLoading } = useQuery<ConsumptionReport>({
    queryKey: ['reports-consumption', params],
    queryFn: async () => (await api.get('/reports/consumption', { params })).data,
  })

  return (
    <div className="space-y-4">
      <ReportHeader title="Reporte de Consumo" description="" icon={Activity} />
      
      <div className="glass-card p-4 flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilters dateFrom={dateFrom} dateTo={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
        <ExportButtons reportType="consumption" params={params} />
      </div>

      {isLoading || !data ? (
        <div className="glass-card p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="glass-card overflow-hidden">
            <h3 className="text-sm font-semibold text-foreground p-4 pb-0">Top consumidores</h3>
            <table className="w-full text-sm mt-2">
              <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/50"><th className="px-4 py-2">Cliente</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2 text-right">Consumo</th></tr></thead>
              <tbody>
                {data.top_consumers.map((c) => (
                  <tr key={c.client_id} className="border-b border-border/30">
                    <td className="px-4 py-2">{c.client_name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.plan_name ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatVolume(c.total_bytes)}</td>
                  </tr>
                ))}
                {data.top_consumers.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">Sin datos de tráfico en el período.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-card overflow-hidden">
              <h3 className="text-sm font-semibold text-foreground p-4 pb-0">Promedio por plan</h3>
              <table className="w-full text-sm mt-2">
                <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/50"><th className="px-4 py-2">Plan</th><th className="px-4 py-2 text-right">Promedio / cliente</th><th className="px-4 py-2 text-right">Clientes</th></tr></thead>
                <tbody>
                  {data.by_plan.map((p) => (
                    <tr key={p.plan_name} className="border-b border-border/30">
                      <td className="px-4 py-2">{p.plan_name}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatVolume(p.avg_bytes_per_client)}</td>
                      <td className="px-4 py-2 text-right">{p.clients_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Clock className="w-4 h-4" /> Horas pico</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart accessibilityLayer={false} data={[...data.peak_hours].sort((a, b) => a.hour - b.hour)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatVolume(v)} width={70} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [formatVolume(v), 'Consumo']} labelFormatter={(h) => `${h}:00`} />
                  <Bar dataKey="total_bytes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
