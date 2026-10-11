import { Shuffle, Network, Plus, Pencil, X, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { saveButtonClass } from '@/lib/utils'
import { formatSpeed } from '@/components/charts/TrafficChart'
import type { WanLink } from '@/pages/devices/load-balancers/WanLinkFormDialog'
import { PortStatusBadge } from '../PortStatusBadge'
import type { ApplyResult, LbInterface } from '../types'

interface BalancingTabProps {
  isAdmin: boolean
  algorithm: 'pcc' | 'failover'
  wanLinks: WanLink[]
  interfaces: LbInterface[]
  pendingApply: boolean
  applyResult: ApplyResult | null
  isApplying: boolean
  onAlgorithmChange: (next: 'pcc' | 'failover') => void
  onAddLink: () => void
  onEditLink: (index: number) => void
  onRemoveLink: (index: number) => void
  onApply: () => void
}

export function BalancingTab({
  isAdmin, algorithm, wanLinks, interfaces, pendingApply, applyResult, isApplying,
  onAlgorithmChange, onAddLink, onEditLink, onRemoveLink, onApply,
}: BalancingTabProps) {
  return (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <Shuffle className="w-4.5 h-4.5" />
              <span>Algoritmo de balanceo</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onAlgorithmChange('pcc')}
                className={`text-left p-4 rounded-lg border transition-colors ${algorithm === 'pcc' ? 'border-brand-500 bg-brand-500/10' : 'border-border/40 hover:border-border'}`}
              >
                <p className="text-sm font-semibold text-foreground">PCC</p>
                <p className="text-xs text-muted-foreground mt-1">Per Connection Classifier — reparte el tráfico entre todos los enlaces WAN, manteniendo cada sesión estable en el mismo enlace. Ideal para balancear varias salidas a internet.</p>
              </button>
              <button
                type="button"
                onClick={() => onAlgorithmChange('failover')}
                className={`text-left p-4 rounded-lg border transition-colors ${algorithm === 'failover' ? 'border-brand-500 bg-brand-500/10' : 'border-border/40 hover:border-border'}`}
              >
                <p className="text-sm font-semibold text-foreground">Failover</p>
                <p className="text-xs text-muted-foreground mt-1">Un enlace principal y uno o más de respaldo — conmuta automáticamente si el principal deja de responder (check-gateway).</p>
              </button>
            </div>
          </div>

          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm">
                <Network className="w-4.5 h-4.5" />
                <span>Enlaces WAN</span>
              </div>
              {isAdmin && (
                <button type="button" onClick={onAddLink} className="btn-secondary text-xs py-1.5 px-3">
                  <Plus className="w-3.5 h-3.5" />
                  Agregar enlace
                </button>
              )}
            </div>

            {wanLinks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                No hay enlaces WAN configurados. Agrega al menos 2 para activar el balanceo de carga.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Interfaz</th>
                      <th>Estado</th>
                      <th>Gateway</th>
                      <th>Tráfico</th>
                      <th>{algorithm === 'pcc' ? 'Peso / Participación' : 'Prioridad / Rol'}</th>
                      {isAdmin && <th className="text-right">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totalWeight = wanLinks.reduce((acc, l) => acc + Math.max(1, l.weight), 0)
                      const failoverOrder = [...wanLinks]
                        .map((link, index) => ({ link, index }))
                        .sort((a, b) => a.link.priority - b.link.priority)
                      const roleByIndex: Record<number, string> = {}
                      failoverOrder.forEach(({ index }, order) => {
                        roleByIndex[index] = order === 0 ? 'Principal' : `Respaldo ${order}`
                      })

                      return wanLinks.map((link, index) => {
                        const iface = interfaces.find((i) => i.name === link.interface)
                        const sharePct = Math.round((Math.max(1, link.weight) / totalWeight) * 100)
                        return (
                          <tr key={index}>
                            <td className="font-mono text-sm font-semibold text-foreground">{link.interface}</td>
                            <td>
                              {iface ? (
                                <PortStatusBadge running={iface.running} disabled={iface.disabled} />
                              ) : (
                                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                  Sin detectar
                                </span>
                              )}
                            </td>
                            <td className="font-mono text-xs text-muted-foreground">{link.gateway}</td>
                            <td className="font-mono text-xs">
                              {iface && iface.running ? (
                                <>
                                  <span className="text-cyan-400 font-semibold">↓ {formatSpeed(iface.rx_rate)}</span>
                                  {' '}
                                  <span className="text-violet-400 font-semibold">↑ {formatSpeed(iface.tx_rate)}</span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td>
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 whitespace-nowrap">
                                {algorithm === 'pcc'
                                  ? `Peso ${link.weight} · ~${sharePct}%`
                                  : `${roleByIndex[index]} · prioridad ${link.priority}`}
                              </span>
                            </td>
                            {isAdmin && (
                              <td className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button type="button" onClick={() => onEditLink(index)} className="btn-secondary py-1 px-2.5 text-xs">
                                    <Pencil className="w-3.5 h-3.5" />
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRemoveLink(index)}
                                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Quitar enlace"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>
            )}
            {wanLinks.length === 1 && (
              <p className="text-xs text-amber-400">Agrega al menos un enlace más para poder aplicar el balanceo en el equipo.</p>
            )}

            {isAdmin && wanLinks.length >= 2 && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground">
                  {pendingApply
                    ? 'Hay cambios sin aplicar en el equipo.'
                    : 'La configuración guardada coincide con la última aplicada.'}
                </p>
                <button
                  type="button"
                  onClick={onApply}
                  disabled={isApplying}
                  className={saveButtonClass(pendingApply, isApplying)}
                >
                  {isApplying && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar y aplicar en el equipo
                </button>
              </div>
            )}
          </div>

          {applyResult && (
            <div className={`glass-card p-5 space-y-3 border ${applyResult.success ? 'border-emerald-500/30' : 'border-destructive/30'}`}>
              <div className="flex items-start gap-3">
                {applyResult.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                )}
                <p className={`text-sm font-semibold ${applyResult.success ? 'text-emerald-400' : 'text-destructive'}`}>
                  {applyResult.message}
                </p>
              </div>
              {applyResult.source && (
                <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{applyResult.source}</pre>
              )}
              {applyResult.output && (
                <pre className="text-xs font-mono text-destructive bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{applyResult.output}</pre>
              )}
            </div>
          )}
        </div>
  )
}
