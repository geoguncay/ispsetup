import { Link } from 'react-router-dom'
import { Server, Wifi, WifiOff, HelpCircle, Network } from 'lucide-react'
import { RouterStatusBadge } from '@/pages/devices/shared/RouterStatusBadge'
import { SectionTitle, StatCard } from './StatCard'
import type { DashboardSummary, DeviceStatus, RouterRow } from './types'

interface Props {
  summary: DashboardSummary | undefined
  loading: boolean
  routers: RouterRow[] | undefined
  routersLoading: boolean
  routersError: boolean
}

const ORDER: Record<string, number> = { offline: 0, tunnel_down: 1, degraded: 2, unknown: 3, online: 4 }

export function InfraSection({ summary, loading, routers, routersLoading, routersError }: Props) {
  const r = summary?.infra.routers
  const lb = summary?.infra.load_balancers
  const problems = r ? r.offline + r.tunnel_down + r.degraded : 0

  // Primero los que requieren atención.
  const sorted = [...(routers ?? [])].sort(
    (a, b) => (ORDER[a.status ?? 'unknown'] ?? 3) - (ORDER[b.status ?? 'unknown'] ?? 3) || a.name.localeCompare(b.name),
  )

  return (
    <section>
      <SectionTitle>Infraestructura</SectionTitle>
      <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Routers" value={r?.total ?? 0} icon={Server} tone="brand" to="/routers" loading={loading} />
        <StatCard label="En línea" value={r?.online ?? 0} icon={Wifi} tone="emerald" loading={loading} />
        <StatCard
          label="Con problemas"
          value={problems}
          icon={WifiOff}
          tone={problems > 0 ? 'red' : 'slate'}
          hint={r && r.unknown > 0 ? `${r.unknown} sin estado` : undefined}
          loading={loading}
        />
        <StatCard
          label="Balanceadores"
          value={lb?.total ?? 0}
          icon={Network}
          tone={lb && lb.offline + lb.tunnel_down > 0 ? 'red' : 'violet'}
          hint={lb && lb.total > 0 ? `${lb.online} en línea` : undefined}
          to="/load-balancers"
          loading={loading}
        />
      </div>

      <div className="glass-card p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Estado de routers</h2>
          <span className="text-xs text-muted-foreground">Actualiza cada 30 s</span>
        </div>

        {routersError ? (
          <p className="text-sm text-red-400 py-6 text-center">No se pudo cargar la lista de routers.</p>
        ) : routersLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
        ) : sorted.length === 0 ? (
          <div className="text-center py-8">
            <HelpCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No hay routers registrados</p>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {sorted.slice(0, 8).map((router) => (
              <Link
                key={router.id}
                to={`/routers/${router.id}`}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 bg-brand-900/50 rounded-md flex items-center justify-center border border-brand-800/40 flex-shrink-0">
                    <Server className="w-3.5 h-3.5 text-brand-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{router.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{router.ip}</p>
                  </div>
                </div>
                <RouterStatusBadge status={(router.status ?? 'unknown') as DeviceStatus} />
              </Link>
            ))}
          </div>
        )}
        {sorted.length > 8 && (
          <Link to="/routers" className="block text-center text-xs text-brand-400 hover:underline mt-3">
            Ver los {sorted.length} routers
          </Link>
        )}
      </div>
    </section>
  )
}
