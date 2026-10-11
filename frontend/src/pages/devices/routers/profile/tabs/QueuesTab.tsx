import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Sliders } from 'lucide-react'
import api from '@/services/api'
import { formatQueueLimit } from '../format'

interface QueuesTabProps {
  routerId: string | undefined
  router: any
}

/** Colas simples configuradas en el router. */
export function QueuesTab({ routerId: id, router }: QueuesTabProps) {
  const navigate = useNavigate()

  const { data: queues = [], isLoading: isLoadingQueues } = useQuery({
    queryKey: ['router-queues', id],
    queryFn: async () => {
      const { data } = await api.get(`/routers/${id}/queues`)
      return data
    },
    enabled: router?.settings_configured === true,
  })

  return (
            <div className="space-y-4">
              {isLoadingQueues ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
                    <span>Cargando colas de tráfico desde el router...</span>
                  </div>
                </div>
              ) : queues.length === 0 ? (
                <div className="glass-card p-8 text-center text-muted-foreground">
                  <Sliders className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
                  No se encontraron colas simples configuradas en este router.
                </div>
              ) : (
                <div className="glass-card overflow-x-auto font-sans">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Cola</th>
                        <th>IP / Target</th>
                        <th> Upload / Download</th>
                        <th>Tráfico actual</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queues.map((q: any) => (
                        <tr key={q.id} className="hover:bg-secondary/40 transition-colors">
                          <td>
                            {q.client_id ? (
                              <div
                                onClick={() => navigate(`/clients/${q.client_id}`)}
                                className="font-semibold text-sm"
                              >
                                {q.name}
                              </div>
                            ) : (
                              <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                {q.name}
                              </div>
                            )}
                          </td>
                          <td>
                            <code className="text-xs font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                              {q.target}
                            </code>
                          </td>
                          <td className="text-xs font-mono font-medium text-foreground">
                            {formatQueueLimit(q.max_limit)}
                          </td>
                          <td className="text-xs font-mono text-brand-400 font-semibold">
                            {q.rate_human}
                          </td>
                          <td>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${!q.disabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-destructive/10 text-destructive border border-destructive/20'
                              }`}>
                              {!q.disabled ? 'Activo' : 'Inactivo'}
                            </span>
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
