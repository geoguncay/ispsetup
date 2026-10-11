import { RefreshCw } from 'lucide-react'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import { formatDate, formatTime } from '@/lib/utils'

interface SuspensionsTabProps {
  suspensionHistory: any[]
  isLoading: boolean
}

export function SuspensionsTab({ suspensionHistory, isLoading: isLoadingSuspensions }: SuspensionsTabProps) {
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  return (
                isLoadingSuspensions ? (
                  <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Cargando historial...
                  </div>
                ) : suspensionHistory.length === 0 ? (
                  <p className="text-center py-6 text-sm text-muted-foreground">Sin historial de suspensiones.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table font-sans">
                      <thead>
                        <tr>
                          <th>Motivo</th>
                          <th>Fecha Suspensión</th>
                          <th>Fecha Reactivación</th>
                          <th>Creador / Operador</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suspensionHistory.map((sh: any) => (
                          <tr key={sh.id}>
                            <td className="text-sm font-semibold text-foreground max-w-xs truncate" title={sh.reason}>
                              {sh.reason}
                            </td>
                            <td className="text-xs text-muted-foreground font-mono">
                              {formatDate(sh.suspended_at, dateFormat)} {formatTime(sh.suspended_at, timeFormat)}
                            </td>
                            <td className="text-xs text-muted-foreground font-mono">
                              {sh.reactivated_at ? (
                                `${formatDate(sh.reactivated_at, dateFormat)} ${formatTime(sh.reactivated_at, timeFormat)}`
                              ) : (
                                <span className="text-rose-400 font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-[10px]">Suspendido</span>
                              )}
                            </td>
                            <td className="text-xs text-foreground font-medium">
                              {sh.user_name ? (
                                <span>{sh.user_name} <span className="text-muted-foreground text-[10px]">(Manual)</span></span>
                              ) : (
                                <span className="text-brand-400 font-bold text-[10px] uppercase tracking-wider bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-500/25">Sistema</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
  )
}
