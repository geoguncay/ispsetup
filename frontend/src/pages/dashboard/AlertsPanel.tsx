import { Link } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardAlert } from './types'

const SEVERITY = {
  critical: { icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-900/20 border-red-800/30' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-800/30' },
  info: { icon: Info, color: 'text-sky-400', bg: 'bg-sky-900/20 border-sky-800/30' },
} as const

interface Props {
  alerts: DashboardAlert[] | undefined
  loading: boolean
  error: boolean
}

export function AlertsPanel({ alerts, loading, error }: Props) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Alertas</h2>
        {!loading && alerts && alerts.length > 0 && (
          <span className="text-xs text-muted-foreground">{alerts.length} activas</span>
        )}
      </div>

      {error && !alerts ? (
        <p className="text-sm text-red-400 py-6 text-center">No se pudieron calcular las alertas.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
      ) : !alerts || alerts.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Todo en orden, sin alertas activas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const s = SEVERITY[a.severity]
            const Icon = s.icon
            const body = (
              <div className={cn('flex items-start gap-3 rounded-lg border p-3', s.bg)}>
                <Icon className={cn('w-4 h-4 mt-0.5 flex-shrink-0', s.color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{a.title}</p>
                  {a.detail && <p className="text-xs text-muted-foreground mt-0.5">{a.detail}</p>}
                </div>
                <span className={cn('text-lg font-bold', s.color)}>{a.count}</span>
              </div>
            )
            return a.link ? (
              <Link key={a.code} to={a.link} className="block hover:brightness-125 transition">{body}</Link>
            ) : (
              <div key={a.code}>{body}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
