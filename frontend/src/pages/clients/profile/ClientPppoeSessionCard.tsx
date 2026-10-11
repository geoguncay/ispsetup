interface ClientPppoeSessionCardProps {
  activeSession: any
  isDisconnecting: boolean
  onDisconnect: () => void
}

/** Estado de la sesión PPPoE en tiempo real (solo clientes PPPoE). */
export function ClientPppoeSessionCard({ activeSession, isDisconnecting, onDisconnect }: ClientPppoeSessionCardProps) {
  return (
                <div className="border-t border-border/50 pt-4 mt-4 space-y-3 font-sans">
                  <div className="bg-secondary/10 p-4 rounded-lg border border-border/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase">Estado de Sesión Activa</span>
                      {activeSession ? (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25">
                          ● Conectado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-muted-foreground px-2 py-0.5 rounded-full bg-secondary border border-border">
                          Desconectado
                        </span>
                      )}
                    </div>

                    {activeSession ? (
                      <div className="space-y-3 animate-fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Dirección IP Asignada</span>
                            <span className="text-xs font-semibold text-foreground font-mono">{activeSession.ip_address}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Tiempo de Conexión</span>
                            <span className="text-xs font-semibold text-foreground font-mono">{activeSession.uptime || '—'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Dirección MAC</span>
                            <span className="text-xs font-semibold text-foreground font-mono">{activeSession.caller_id || '—'}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/20">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Tráfico Descarga (RX)</span>
                            <span className="text-xs font-bold text-emerald-400 font-mono">↓ {activeSession.bytes_rx_human || '0 B'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Tráfico Subida (TX)</span>
                            <span className="text-xs font-bold text-blue-400 font-mono">↑ {activeSession.bytes_tx_human || '0 B'}</span>
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={onDisconnect}
                            disabled={isDisconnecting}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 transition-all active:scale-[0.98]"
                          >
                            {isDisconnecting ? 'Desconectando...' : 'Desconectar Sesión (Kick)'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">El cliente no tiene una sesión activa en este momento.</p>
                    )}
                  </div>
                </div>
  )
}
