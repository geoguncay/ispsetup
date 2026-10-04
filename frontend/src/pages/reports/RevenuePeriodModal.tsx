import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Receipt, Loader2, DollarSign, X } from 'lucide-react'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '@/services/api'
import { KpiCard, TOOLTIP_STYLE } from '@/pages/ReportsPage'
import type { RevenuePeriodDetail } from '@/pages/ReportsPage'

function BreakdownTable({ title, nameHeader, rows }: { title: string; nameHeader: string; rows: { name: string; amount: number; count: number }[] }) {
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <h4 className="text-xs font-semibold text-foreground px-3 pt-3">{title}</h4>
      <table className="w-full text-sm mt-2">
        <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border/50"><th className="px-3 py-1.5">{nameHeader}</th><th className="px-3 py-1.5 text-right">Monto</th><th className="px-3 py-1.5 text-right">Pagos</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-3 text-center text-xs text-muted-foreground">Sin pagos</td></tr>
          ) : rows.map((r) => (
            <tr key={r.name} className="border-b border-border/30 last:border-0">
              <td className="px-3 py-1.5">{r.name}</td>
              <td className="px-3 py-1.5 text-right font-mono">${r.amount.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RevenuePeriodModal({
  label, groupBy, dateFrom, onClose,
}: { label: string; groupBy: string; dateFrom: string; onClose: () => void }) {
  const [tab, setTab] = useState<'simple' | 'accumulated'>('simple')
  const params: Record<string, string> = { label, group_by: groupBy }
  if (dateFrom) params.date_from = dateFrom

  const { data, isLoading, isError } = useQuery<RevenuePeriodDetail>({
    queryKey: ['reports-revenue-period', params],
    queryFn: async () => (await api.get('/reports/revenue/period', { params })).data,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const slice = data?.[tab]
  const isSimple = tab === 'simple'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <section role="dialog" aria-modal="true" className="glass-card flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden border border-border shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-brand-400" /> Ingresos {label}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {isSimple
                ? 'Lo cobrado únicamente dentro de este período.'
                : 'Lo cobrado desde el inicio del rango hasta el fin de este período.'}
            </p>
          </div>
          <button onClick={onClose} className="btn-secondary !p-2" aria-label="Cerrar"><X className="w-4 h-4" /></button>
        </header>

        <div className="flex gap-1 px-5 pt-4">
          {(['simple', 'accumulated'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                tab === t ? 'bg-brand-500/15 text-brand-300 border-brand-500/30' : 'text-muted-foreground border-border/50 hover:text-foreground'
              }`}
            >
              {t === 'simple' ? 'Simple' : 'Acumulado'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : isError || !slice ? (
            <p className="text-sm text-red-400 text-center p-8">No se pudo cargar el detalle del período.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <KpiCard label={isSimple ? 'Total del período' : 'Total acumulado'} value={`$${slice.total_amount.toFixed(2)}`} icon={DollarSign} accent="text-emerald-400" />
                <KpiCard label="Pagos" value={String(slice.total_payments)} icon={Receipt} />
              </div>

              <div className="rounded-lg border border-border/50 p-3">
                <h4 className="text-xs font-semibold text-foreground mb-2">
                  {isSimple ? 'Ingresos por día' : 'Ingreso acumulado por día'}
                </h4>
                {slice.series.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-10">Sin pagos en este rango.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    {isSimple ? (
                      <BarChart accessibilityLayer={false} data={slice.series}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(8)} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Monto']} />
                        <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    ) : (
                      <AreaChart accessibilityLayer={false} data={slice.series}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Acumulado']} />
                        <Area type="stepAfter" dataKey="amount" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <BreakdownTable title="Por plan" nameHeader="Plan" rows={slice.by_plan.map((p) => ({ name: p.plan_name, amount: p.amount, count: p.payments_count }))} />
                <BreakdownTable title="Por sitio" nameHeader="Sitio" rows={slice.by_site.map((x) => ({ name: x.site_name, amount: x.amount, count: x.payments_count }))} />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
