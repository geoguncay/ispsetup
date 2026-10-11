import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Shield } from 'lucide-react'
import api from '@/services/api'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'
import type { ClientPlan } from '../types'

interface PlansTabProps {
  clientId: string | undefined
  client: any
}

/** Servicios contratados en curso e historial de asignación de planes. */
export function PlansTab({ clientId: id, client }: PlansTabProps) {
  const dateFormat = useDateFormat()

  // Consultar Historial de Planes
  const { data: planHistory = [], isLoading: isLoadingHistory } = useQuery<ClientPlan[]>({
    queryKey: ['client-plans', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/plans`)
      return data
    }
  })

  return (
                <div className="space-y-6 font-sans">
                  {/* Sección destacada de Servicios Activos */}
                  <div className="glass-card p-5 border border-brand-500/20 bg-brand-500/5 space-y-4">
                    <h3 className="text-sm font-bold text-brand-300 uppercase tracking-wider flex items-center gap-2">
                      <Shield className="w-4 h-4 text-brand-400" /> Servicios Contratados en Curso
                    </h3>
                    <div className="divide-y divide-border/40 text-xs">
                      {/* Plan Base */}
                      <div className="flex justify-between py-2.5 items-center">
                        <div>
                          <span className="font-semibold text-foreground text-sm block">
                            {client.plan_activo?.name ?? 'Sin plan activo contratado'}
                          </span>
                          <span className="text-muted-foreground text-[11px]">Plan de Internet base</span>
                        </div>
                        <span className="font-bold text-brand-400 font-mono text-sm">
                          ${client.plan_activo ? Number(client.plan_activo.price).toFixed(2) : '0.00'} /mes
                        </span>
                      </div>

                      {/* Servicios Adicionales */}
                      {client.custom_services && client.custom_services.map((cs: any) => (
                        <div key={cs.id} className="flex justify-between py-2.5 items-center">
                          <div>
                            <span className="font-semibold text-foreground text-sm flex items-center gap-2">
                              {cs.name}
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.1 rounded border ${
                                cs.recurring
                                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                  : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                              }`}>
                                {cs.recurring ? 'Mensual' : 'Pago Único'}
                              </span>
                            </span>
                            <span className="text-muted-foreground text-[11px]">{cs.description || 'Servicio de valor agregado'}</span>
                          </div>
                          <span className="font-bold text-brand-400 font-mono text-sm">
                            +${Number(cs.price).toFixed(2)} {cs.recurring ? '/mes' : ''}
                          </span>
                        </div>
                      ))}

                      {/* Totales Desglosados */}
                      {client.custom_services && client.custom_services.some((cs: any) => !cs.recurring) ? (
                        <>
                          <div className="flex justify-between py-2 border-t border-border/40 font-semibold text-muted-foreground">
                            <span>Total Mensual Recurrente:</span>
                            <span className="font-mono text-foreground">
                              ${(
                                (client.plan_activo ? Number(client.plan_activo.price) : 0) +
                                (client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + (cs.recurring ? Number(cs.price) : 0), 0) : 0)
                              ).toFixed(2)} /mes
                            </span>
                          </div>
                          <div className="flex justify-between py-2 font-semibold text-purple-400">
                            <span>Cargos Únicos Pendientes:</span>
                            <span className="font-mono text-purple-400">
                              +${(
                                client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + (!cs.recurring ? Number(cs.price) : 0), 0) : 0
                              ).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between py-3 items-center border-t border-border font-bold">
                            <div>
                              <span className="text-sm text-foreground uppercase tracking-wider block">Monto Próxima Factura</span>
                              <span className="text-[10px] text-muted-foreground font-normal">Suma de mensualidad y cargos únicos pendientes</span>
                            </div>
                            <span className="text-lg font-mono font-black text-brand-400">
                              ${(
                                (client.plan_activo ? Number(client.plan_activo.price) : 0) +
                                (client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + Number(cs.price), 0) : 0)
                              ).toFixed(2)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between py-3 items-center border-t border-border font-bold">
                          <div>
                            <span className="text-sm text-foreground uppercase tracking-wider block">Total de Facturación Mensual</span>
                            <span className="text-[10px] text-muted-foreground font-normal">Valor aproximado antes de impuestos adicionales</span>
                          </div>
                          <span className="text-lg font-mono font-black text-brand-400">
                            ${(
                              (client.plan_activo ? Number(client.plan_activo.price) : 0) +
                              (client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + Number(cs.price), 0) : 0)
                            ).toFixed(2)} /mes
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Historial de Planes Asignados */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Historial de Asignación de Planes
                    </h3>
                    {isLoadingHistory ? (
                      <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Cargando historial...
                      </div>
                    ) : planHistory.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground bg-secondary/10 rounded-lg border border-border/50">Sin historial de planes asignados.</p>
                    ) : (
                      <div className="overflow-x-auto glass-card p-2 border-border/40">
                        <table className="data-table text-xs">
                          <thead>
                            <tr>
                              <th>Plan</th>
                              <th>Precio</th>
                              <th>Fecha Inicio</th>
                              <th>Fecha Fin</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {planHistory.map((ph) => (
                              <tr key={ph.id}>
                                <td className="font-semibold text-foreground text-sm">{ph.plan?.name ?? 'Plan Eliminado'}</td>
                                <td className="font-mono text-xs">${ph.plan ? Number(ph.plan.price).toFixed(2) : '0.00'}</td>
                                <td className="text-xs text-muted-foreground font-mono">{formatDate(ph.fecha_inicio, dateFormat)}</td>
                                <td className="text-xs text-muted-foreground font-mono">
                                  {ph.fecha_fin ? formatDate(ph.fecha_fin, dateFormat) : <span className="text-emerald-400 font-medium">Actual</span>}
                                </td>
                                <td>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${ph.estado === 'activo'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                    : ph.estado === 'suspendido'
                                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                                      : 'bg-muted text-muted-foreground border border-border'
                                    }`}>
                                    {ph.estado.toUpperCase()}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
  )
}
