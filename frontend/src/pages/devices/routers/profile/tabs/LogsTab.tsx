import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw, ScrollText } from 'lucide-react'
import api from '@/services/api'

interface LogsTabProps {
  routerId: string | undefined
  pollingPaused: boolean
}

/** Log del sistema RouterOS (solo disponible con debug activo). */
export function LogsTab({ routerId: id, pollingPaused }: LogsTabProps) {
  const { data: logsData, isFetching: fetchingLogs, refetch: refetchLogs } = useQuery<{
    logs: Array<{ time?: string; topics?: string; message?: string }>
    total: number
  }>({
    queryKey: ['router-logs', id],
    queryFn: async () => {
      const { data } = await api.get(`/routers/${id}/logs?limit=150`)
      return data
    },
    refetchInterval: pollingPaused ? false : 10000,
  })

  return (
            <div className="space-y-4 animate-fade-in">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-foreground">
                    Log del sistema RouterOS
                  </span>
                  {logsData && (
                    <span className="text-xs text-muted-foreground">
                      — mostrando últimas {logsData.logs.length} de {logsData.total} entradas
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => refetchLogs()}
                  disabled={fetchingLogs}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  {fetchingLogs
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Actualizar
                </button>
              </div>

              {/* Tabla de logs */}
              {fetchingLogs && !logsData ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Obteniendo logs del router...</span>
                </div>
              ) : logsData && logsData.logs.length > 0 ? (
                <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
                  <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-secondary/60 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <th className="px-4 py-3 w-36">Hora</th>
                          <th className="px-4 py-3 w-40">Categoría</th>
                          <th className="px-4 py-3">Mensaje</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30 font-mono text-xs">
                        {[...logsData.logs].reverse().map((entry, i) => {
                          const topics = entry.topics ?? ''
                          const rowColor = topics.includes('error')
                            ? 'text-red-400 bg-red-500/5'
                            : topics.includes('warning')
                            ? 'text-amber-400 bg-amber-500/5'
                            : topics.includes('debug')
                            ? 'text-blue-400'
                            : 'text-foreground/80'
                          return (
                            <tr key={i} className={`hover:bg-secondary/20 transition-colors ${rowColor}`}>
                              <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                                {entry.time ?? '—'}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap">
                                <span className="px-1.5 py-0.5 rounded bg-secondary/50 text-[10px] font-semibold">
                                  {topics || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-2 break-all">{entry.message ?? ''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
                  <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No hay entradas de log disponibles.</p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Se actualiza automáticamente cada 10 segundos · Debug activo en Ajustes → MikroTik API
              </p>
            </div>
  )
}
