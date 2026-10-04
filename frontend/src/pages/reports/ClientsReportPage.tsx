import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, Loader2 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api from '@/services/api'
import { ExportButtons, DateRangeFilters, KpiCard, ReportHeader, TOOLTIP_STYLE } from '@/pages/ReportsPage'
import type { ClientsReport } from '@/pages/ReportsPage'

export function ClientsReportPage() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const params: Record<string, string> = {}
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo

  const { data, isLoading } = useQuery<ClientsReport>({
    queryKey: ['reports-clients', params],
    queryFn: async () => (await api.get('/reports/clients', { params })).data,
  })

  return (
    <div className="space-y-4">
      <ReportHeader title="Reporte de Clientes" description="" icon={Users} />
      <div className="glass-card p-4 flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilters dateFrom={dateFrom} dateTo={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
        <ExportButtons reportType="clients" params={params} />
      </div>

      {isLoading || !data ? (
        <div className="glass-card p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Total clientes" value={String(data.total_clients)} icon={Users} />
            <KpiCard label="Activos" value={String(data.active_clients)} icon={Users} accent="text-emerald-400" />
            <KpiCard label="Suspendidos" value={String(data.suspended_clients)} icon={Users} accent="text-amber-400" />
          </div>
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Evolución mensual</h3>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart accessibilityLayer={false} data={data.evolution}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend />
                <Area type="monotone" dataKey="new_clients" name="Nuevos" stroke="#10b981" fill="#10b98133" />
                <Area type="monotone" dataKey="suspended_events" name="Suspensiones" stroke="#f59e0b" fill="#f59e0b33" />
                <Area type="monotone" dataKey="churned_clients" name="Bajas (planes cancelados)" stroke="#ef4444" fill="#ef444433" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
