import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TOOLTIP_STYLE } from '@/pages/reports/shared'
import { formatMoney, monthLabel } from './format'
import type { RevenueTrendPoint } from './types'

interface Props {
  points: RevenueTrendPoint[] | undefined
  loading: boolean
  error: boolean
}

export function RevenueChart({ points, loading, error }: Props) {
  const data = (points ?? []).map((p) => ({ ...p, month: monthLabel(p.label) }))
  const hasData = data.some((p) => p.amount > 0)

  return (
    <div className="glass-card relative z-10 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Ingresos de los últimos 6 meses</h2>
        <Link to="/reports/revenue" className="text-xs text-brand-400 hover:underline">Ver reporte</Link>
      </div>

      {error ? (
        <p className="text-sm text-red-400 py-12 text-center">No se pudo cargar la tendencia de ingresos.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Cargando…</p>
      ) : !hasData ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Aún no hay pagos registrados en este periodo</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart accessibilityLayer={false} data={data} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={48} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v: number, _n, item) => [
                `${formatMoney(v)} · ${(item.payload as { payments_count: number }).payments_count} pagos`,
                'Cobrado',
              ]}
            />
            <Bar dataKey="amount" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={72} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
