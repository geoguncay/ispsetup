/**
 * DashboardPage — Panel principal con resumen del sistema.
 */
import { useQuery } from '@tanstack/react-query'
import { Server, Wifi, Users, Bell, Activity, UserCheck, UserX, UserMinus } from 'lucide-react'
import api from '@/services/api'
import { GatewayStatusBadge } from '@/components/GatewayStatusBadge'
import { useAuthStore } from '@/stores/authStore'

interface ClientStats {
  total: number
  connected: number
  disconnected: number
  suspended: number
}

export function DashboardPage() {
  const { user } = useAuthStore()

  const { data: routers = [] } = useQuery({
    queryKey: ['routers'],
    queryFn: async () => {
      const { data } = await api.get('/gateways')
      return data
    },
    refetchInterval: 30_000,
  })

  const { data: clientStats, isLoading: statsLoading } = useQuery<ClientStats>({
    queryKey: ['client-stats'],
    queryFn: async () => {
      const { data } = await api.get('/users/stats')
      return data
    },
    refetchInterval: 60_000,
  })

  const onlineCount = routers.filter((r: { status: string }) => r.status === 'online').length
  const offlineCount = routers.filter((r: { status: string }) => r.status === 'offline').length

  const statValue = (v: number | undefined) => statsLoading ? '—' : (v ?? 0)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Welcome ── */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Bienvenido, {user?.name?.split(' ')[0]} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Resumen del estado de tu red ISP
        </p>
      </div>

      {/* ── KPI Cards — Routers ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Infraestructura
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Routers totales',
              value: routers.length,
              icon: Server,
              color: 'text-brand-400',
              bg: 'bg-brand-900/30',
              border: 'border-brand-800/40',
            },
            {
              label: 'En línea',
              value: onlineCount,
              icon: Wifi,
              color: 'text-emerald-400',
              bg: 'bg-emerald-900/20',
              border: 'border-emerald-800/30',
            },
            {
              label: 'Con problemas',
              value: offlineCount,
              icon: Activity,
              color: 'text-red-400',
              bg: 'bg-red-900/20',
              border: 'border-red-800/30',
            },
            {
              label: 'Alertas activas',
              value: 0,
              icon: Bell,
              color: 'text-amber-400',
              bg: 'bg-amber-900/20',
              border: 'border-amber-800/30',
            },
          ].map(({ label, value, icon: Icon, color, bg, border }) => (
            <div key={label} className={`rounded-xl border ${border} ${bg} p-4 backdrop-blur-sm`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center border ${border}`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── KPI Cards — Clientes ── */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Clientes
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Total clientes',
              value: statValue(clientStats?.total),
              icon: Users,
              color: 'text-violet-400',
              bg: 'bg-violet-900/20',
              border: 'border-violet-800/30',
            },
            {
              label: 'Conectados',
              value: statValue(clientStats?.connected),
              icon: UserCheck,
              color: 'text-emerald-400',
              bg: 'bg-emerald-900/20',
              border: 'border-emerald-800/30',
            },
            {
              label: 'Desconectados',
              value: statValue(clientStats?.disconnected),
              icon: UserMinus,
              color: 'text-sky-400',
              bg: 'bg-sky-900/20',
              border: 'border-sky-800/30',
            },
            {
              label: 'Suspendidos',
              value: statValue(clientStats?.suspended),
              icon: UserX,
              color: 'text-orange-400',
              bg: 'bg-orange-900/20',
              border: 'border-orange-800/30',
            },
          ].map(({ label, value, icon: Icon, color, bg, border }) => (
            <div key={label} className={`rounded-xl border ${border} ${bg} p-4 backdrop-blur-sm`}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center border ${border}`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
              <p className={`text-3xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Estado de routers ── */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Estado de routers</h2>
            <span className="text-xs text-muted-foreground">Actualiza cada 30 s</span>
          </div>

          {routers.length === 0 ? (
            <div className="text-center py-8">
              <Server className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No hay routers registrados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {routers.slice(0, 8).map((router: { id: string; name: string; ip: string; ros_version: string | null; status: string | null }) => (
                <div
                  key={router.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-brand-900/50 rounded-md flex items-center justify-center border border-brand-800/40">
                      <Server className="w-3.5 h-3.5 text-brand-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{router.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {router.ip}
                      </p>
                    </div>
                  </div>
                  <GatewayStatusBadge status={(router.status ?? 'unknown') as 'online' | 'offline' | 'degraded' | 'unknown'} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Actividad reciente (placeholder para fases futuras) ── */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Actividad reciente</h2>
          </div>
          <div className="space-y-3">
            {[
              { msg: 'Sistema iniciado correctamente', time: 'Ahora', color: 'bg-emerald-500' },
              { msg: 'Health checks activados (60 s)', time: 'Ahora', color: 'bg-brand-500' },
            ].map(({ msg, time, color }) => (
              <div key={msg} className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full ${color} mt-1.5 flex-shrink-0`} />
                <div>
                  <p className="text-sm text-foreground">{msg}</p>
                  <p className="text-xs text-muted-foreground">{time}</p>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-2 text-center">
              El historial de actividad estará disponible en la Fase 3
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
