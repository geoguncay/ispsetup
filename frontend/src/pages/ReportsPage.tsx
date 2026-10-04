/**
 * ReportsPage — Base del módulo de reportes (Fase 4.3): tipos, tema de gráficas y
 * componentes compartidos (exportar PDF/Excel, filtros de fecha, KPI, encabezado).
 * Cada reporte vive en su propio archivo en pages/reports/ (Ingresos, Clientes,
 * Consumo, Mora, Tráfico).
 */
import { useState } from 'react'
import {
  Receipt, Download, FileSpreadsheet, Loader2,
} from 'lucide-react'
import api from '@/services/api'

export type ReportType = 'revenue' | 'clients' | 'consumption' | 'overdue'

// ── Tipos (mirror de backend/app/schemas/reports.py) ──────────────────────────
export interface RevenuePeriodPoint { label: string; amount: number; payments_count: number }
export interface RevenueByPlan { plan_id: string | null; plan_name: string; amount: number; payments_count: number }
export interface RevenueBySite { site_id: string | null; site_name: string; amount: number; payments_count: number }
export interface RevenueReport {
  total_amount: number; total_payments: number; group_by: string
  by_period: RevenuePeriodPoint[]; by_plan: RevenueByPlan[]; by_site: RevenueBySite[]
}

export interface RevenueSlice {
  date_from: string; date_to: string; total_amount: number; total_payments: number
  by_plan: RevenueByPlan[]; by_site: RevenueBySite[]; series: RevenuePeriodPoint[]
}
export interface RevenuePeriodDetail { label: string; group_by: string; simple: RevenueSlice; accumulated: RevenueSlice }

// Estilos de Tooltip de recharts acordes al tema oscuro (por defecto salen blancos).
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))',
    borderRadius: 8, fontSize: 12, color: 'hsl(var(--popover-foreground))',
  },
  labelStyle: { color: 'hsl(var(--popover-foreground))' },
  // Con <Cell> el item no recibe color de serie y recharts cae a negro (invisible en tema oscuro).
  itemStyle: { color: 'green' },
  wrapperStyle: { zIndex: 50, outline: 'none' },
  cursor: { fill: 'rgba(100, 163, 184, 0.08)' },
}

export interface ClientsMonthPoint { label: string; new_clients: number; suspended_events: number; churned_clients: number }
export interface ClientsReport {
  total_clients: number; active_clients: number; suspended_clients: number; evolution: ClientsMonthPoint[]
}

export interface TopConsumerPoint { client_id: string; client_name: string; plan_name: string | null; total_bytes: number }
export interface PlanAveragePoint { plan_id: string | null; plan_name: string; avg_bytes_per_client: number; clients_count: number }
export interface PeakHourPoint { hour: number; total_bytes: number }
export interface ConsumptionReport {
  top_consumers: TopConsumerPoint[]; by_plan: PlanAveragePoint[]; peak_hours: PeakHourPoint[]
}

export interface OverdueInvoicePoint {
  invoice_id: string; client_id: string; client_name: string; plan_name: string | null
  period: string; due_date: string; days_overdue: number; amount: number
}
export interface OverdueReport {
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

export function ExportButtons({ reportType, params }: { reportType: ReportType; params: Record<string, string> }) {
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

export function DateRangeFilters({
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

export function KpiCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Receipt; accent?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${accent ?? 'text-foreground'}`}>{value}</div>
    </div>
  )
}

export function ReportHeader({ title, description, icon: Icon }: { title: string; description: string; icon: typeof Receipt }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Icon className="w-5 h-5 text-brand-400" /> {title}
      </h1>
      <p className="text-muted-foreground text-xs mt-1">{description}</p>
    </div>
  )
}
