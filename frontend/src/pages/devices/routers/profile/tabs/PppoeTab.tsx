import { useQuery, useMutation } from '@tanstack/react-query'
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import api from '@/services/api'

interface PppoeTabProps {
  routerId: string | undefined
  router: any
  isAdmin: boolean
  /** Pausa el polling mientras hay un modal abierto en la página. */
  pollingPaused: boolean
  onProfilesSynced: () => void
}

/** Sesiones PPPoE activas del router y sincronización de perfiles. */
export function PppoeTab({ routerId: id, router, isAdmin, pollingPaused, onProfilesSynced }: PppoeTabProps) {
  const { data: pppoeSessions = [], isLoading: isLoadingSessions, refetch: refetchSessions } = useQuery<any[]>({
    queryKey: ['router-pppoe-sessions', id],
    queryFn: async () => {
      const { data } = await api.get(`/routers/${id}/pppoe-sessions`)
      return data
    },
    enabled: router?.settings_configured === true,
    refetchInterval: pollingPaused ? false : 8000,
  })

  const disconnectSessionMutation = useMutation({
    mutationFn: async (username: string) => {
      await api.delete(`/routers/${id}/pppoe-sessions/${username}`)
    },
    onSuccess: () => {
      refetchSessions()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al desconectar la sesión'
      alert(msg)
    }
  })

  const syncProfilesMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/routers/${id}/sync-pppoe-profiles`)
    },
    onSuccess: () => {
      onProfilesSynced()
      alert('Perfiles PPPoE sincronizados correctamente.')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al sincronizar perfiles PPPoE'
      alert(msg)
    }
  })

  return (
            <div className="space-y-6 font-sans animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Sesiones PPPoE en tiempo real</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Monitoreo de clientes conectados por túnel PPPoE en este router.
                  </p>
                </div>
                
                {isAdmin && (
                  <button
                    onClick={() => {
                      if (confirm('¿Deseas sincronizar los perfiles PPPoE desde el router?')) {
                        syncProfilesMutation.mutate()
                      }
                    }}
                    disabled={syncProfilesMutation.isPending}
                    className="btn-secondary text-xs h-auto py-1.5"
                  >
                    {syncProfilesMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Sincronizar Perfiles
                  </button>
                )}
              </div>

              {router.status !== 'online' ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-xs text-amber-500 font-sans flex items-start gap-2.5">
                  <AlertCircle className="w-4.5 h-4.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span>El router se encuentra fuera de línea. No se pueden recuperar las sesiones PPPoE activas en este momento.</span>
                </div>
              ) : isLoadingSessions ? (
                <div className="text-center py-12 text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <span>Cargando sesiones PPPoE activas...</span>
                </div>
              ) : pppoeSessions.length === 0 ? (
                <div className="glass-card p-8 text-center text-muted-foreground font-sans border border-border/40">
                  No hay sesiones PPPoE activas en este momento.
                </div>
              ) : (
                <div className="overflow-x-auto border border-border/40 rounded-lg">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Usuario</th>
                        <th>Dirección IP</th>
                        <th>Uptime / Tiempo Conectado</th>
                        <th>Dirección MAC</th>
                        <th>Tráfico (Descarga ↓ / Subida ↑)</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pppoeSessions.map((session) => (
                        <tr key={session.id || session.username}>
                          <td className="font-semibold text-foreground text-sm font-mono">{session.username}</td>
                          <td className="font-mono text-xs">{session.ip_address || '—'}</td>
                          <td className="text-xs text-muted-foreground font-mono">{session.uptime || '—'}</td>
                          <td className="text-xs text-muted-foreground font-mono">{session.caller_id || '—'}</td>
                          <td className="text-xs font-mono">
                            <span className="text-emerald-400 font-semibold block">↓ {session.bytes_rx_human || '0 B'}</span>
                            <span className="text-blue-400 font-semibold block">↑ {session.bytes_tx_human || '0 B'}</span>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`¿Estás seguro de que deseas expulsar (kick) al usuario ${session.username}?`)) {
                                  disconnectSessionMutation.mutate(session.username)
                                }
                              }}
                              disabled={disconnectSessionMutation.isPending}
                              className="text-xs font-bold px-2.5 py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 active:scale-[0.98] transition-all"
                            >
                              Kick
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
  )
}
