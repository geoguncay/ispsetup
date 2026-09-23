/**
 * ReportsPage — Módulo de reportes (Fase 4.3): ingresos, clientes, consumo y mora,
 * cada uno con selector de período/filtros y descarga en PDF / Excel.
 * Cada reporte es una página propia (/reports/revenue, /reports/clients, ...).
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Receipt, Users, Activity, AlertTriangle, Download, FileSpreadsheet, Loader2,
  DollarSign, TrendingUp, Clock,
} from 'lucide-react'
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import api from '@/services/api'
import { formatVolume } from '@/lib/traffic'
import { SubscribersStatsPage } from '@/pages/SubscribersStatsPage'

type ReportType = 'revenue' | 'clients' | 'consumption' | 'overdue'

// ── Tipos (mirror de backend/app/schemas/reports.py) ──────────────────────────
interface RevenuePeriodPoint { label: string; amount: number; payments_count: number }
interface RevenueByPlan { plan_id: string | null; plan_name: string; amount: number; payments_count: number }
interface RevenueBySite { site_id: string | null; site_name: string; amount: number; payments_count: number }
interface RevenueReport {
  total_amount: number; total_payments: number; group_by: string
  by_period: RevenuePeriodPoint[]; by_plan: RevenueByPlan[]; by_site: RevenueBySite[]
}

interface ClientsMonthPoint { label: string; new_clients: number; suspended_events: number; churned_clients: number }
interface ClientsReport {
  total_clients: number; active_clients: number; suspended_clients: number; evolution: ClientsMonthPoint[]
}

interface TopConsumerPoint { client_id: string; client_name: string; plan_name: string | null; total_bytes: number }
interface PlanAveragePoint { plan_id: string | null; plan_name: string; avg_bytes_per_client: number; clients_count: number }
interface PeakHourPoint { hour: number; total_bytes: number }
interface ConsumptionReport {
  top_consumers: TopConsumerPoint[]; by_plan: PlanAveragePoint[]; peak_hours: PeakHourPoint[]
}

interface OverdueInvoicePoint {
  invoice_id: string; client_id: string; client_name: string; plan_name: string | null
  period: string; due_date: string; days_overdue: number; amount: number
}
interface OverdueReport {
  total_amount: number; total_invoices: number; total_clients: number; items: OverdueInvoicePoint[]
}

async function downloadReport(reportType: ReportType, format: 'pdf' | 'excel', params: Record<string, string>) {
  const query = new URLSearchParams(params).toString()
  const response = await api.get(`/reports/${reportType}/${format}${query ? `?${query}` : ''}`, { responseType: 'blob' })
  const ext = format === 'pdf' ? 'pdf' : 'xlsx'
  const mime = format === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const blob = new Blob([response.data], { type: mime })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `reporte_${reportType}.${ext}`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function ExportButtons({ reportType, params }: { reportType: ReportType; params: Record<string, string> }) {
  const [loading, setLoading] = useState<'pdf' | 'excel' | null>(null)

  const handle = async (format: 'pdf' | 'excel') => {
    setLoading(format)
    try {
      await downloadReport(reportType, format, params)
    } catch {
      alert('Error al generar el archivo del reporte.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => handle('pdf')} disabled={loading !== null} className="btn-secondary">
        {loading === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        PDF
      </button>
      <button onClick={() => handle('excel')} disabled={loading !== null} className="btn-secondary">
        {loading === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
        Excel
      </button>
    </div>
  )
}

function DateRangeFilters({
  dateFrom, dateTo, onFrom, onTo,
}: { dateFrom: string; dateTo: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Desde</label>
        <input type="date" value={dateFrom} onChange={(e) => onFrom(e.target.value)} className="input-field !py-1.5" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Hasta</label>
        <input type="date" value={dateTo} onChange={(e) => onTo(e.target.value)} className="input-field !py-1.5" />
      </div>
    </div>
  )
}

function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Receipt; accent?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${accent ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

function ReportHeader({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Receipt }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Icon className="w-5 h-5 text-brand-400" /> {title}
      </h1>
      <p className="text-muted-foreground text-xs mt-1">{description}</p>
    </div>
  )
}

// ── Ingresos ──────────────────────────────────────────────────────────────────
export function RevenueReportPage() {
  const [groupBy, setGroupBy] = useState<'month' | 'quarter' | 'year'>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const params: Record<string, string> = { group_by: groupBy }
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo

  const { data, isLoading } = useQuery<RevenueReport>({
    queryKey: ['reports-revenue', params],
    queryFn: async () => (await api.get('/reports/revenue', { params })).data,
  })

  return (
    <div className="space-y-4">
      <ReportHeader title="Reporte de Ingresos" description="Ingresos por período, plan y sede, con exportación a PDF y Excel." icon={DollarSign} />
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

          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Ingresos por período</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.by_period}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Monto']} />
                <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
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
    </div>
  )
}

// ── Clientes ──────────────────────────────────────────────────────────────────
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
      <ReportHeader title="Reporte de Clientes" description="Evolución de clientes y estadísticas de suscriptores, con exportación a PDF y Excel." icon={Users} />
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
              <AreaChart data={data.evolution}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="new_clients" name="Nuevos" stroke="#10b981" fill="#10b98133" />
                <Area type="monotone" dataKey="suspended_events" name="Suspensiones" stroke="#f59e0b" fill="#f59e0b33" />
                <Area type="monotone" dataKey="churned_clients" name="Bajas (planes cancelados)" stroke="#ef4444" fill="#ef444433" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="border-t border-border/50 pt-6">
        <SubscribersStatsPage />
      </div>
    </div>
  )
}

// ── Consumo ───────────────────────────────────────────────────────────────────
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
      <ReportHeader title="Reporte de Consumo" description="Top consumidores, promedio por plan y horas pico, con exportación a PDF y Excel." icon={Activity} />
      
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
                <BarChart data={[...data.peak_hours].sort((a, b) => a.hour - b.hour)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatVolume(v)} width={70} />
                  <Tooltip formatter={(v: number) => [formatVolume(v), 'Consumo']} labelFormatter={(h) => `${h}:00`} />
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

// ── Mora ──────────────────────────────────────────────────────────────────────
export function OverdueReportPage() {
  const { data, isLoading } = useQuery<OverdueReport>({
    queryKey: ['reports-overdue'],
    queryFn: async () => (await api.get('/reports/overdue')).data,
  })

  return (
    <div className="space-y-4">
      <ReportHeader title="Reporte de Mora" description="Facturas vencidas y clientes en mora, con exportación a PDF y Excel." icon={AlertTriangle} />
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
