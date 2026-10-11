import { CheckCircle2, XCircle, CalendarClock } from 'lucide-react'

interface ClientTitleBarProps {
  client: any
  allowDeferral: boolean
  isSuspending: boolean
  isReactivating: boolean
  onDefer: () => void
  onSuspend: () => void
  onDeferReactivation: () => void
  onReactivate: () => void
}

/** Nombre del cliente, badge de estado y acciones de suspensión / reactivación. */
export function ClientTitleBar({
  client, allowDeferral, isSuspending, isReactivating,
  onDefer, onSuspend, onDeferReactivation, onReactivate,
}: ClientTitleBarProps) {
  return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                <h1 className="text-2xl font-bold text-foreground mb-1">{client.full_name}</h1>
                {/* Badge de estado y toggle */}
                <div className="flex md:justify-end gap-3">
                  {/* Badge */}
                  {client.active && client.scheduled_suspension ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/25">
                      <CalendarClock className="w-3.5 h-3.5" />
                      Programado
                    </span>
                  ) : client.active ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Activo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/25">
                      <XCircle className="w-3.5 h-3.5" />
                      Suspendido
                    </span>
                  )}

                  {client.active ? (
                    <>
                      {/* Botón Aplazar (abre modal independiente) */}
                      {allowDeferral && (
                        <button
                          onClick={onDefer}
                          className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/25"
                        >
                          Aplazar
                        </button>
                      )}

                      {/* Botón Suspender (abre modal independiente) */}
                      <button
                        onClick={onSuspend}
                        disabled={isSuspending}
                        className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/25"
                      >
                        {isSuspending ? 'Cargando...' : 'Suspender'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Botón Aplazar (programar reactivación automática) */}
                      {allowDeferral && (
                        <button
                          onClick={onDeferReactivation}
                          className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/25"
                        >
                          Aplazar
                        </button>
                      )}

                      <button
                        onClick={onReactivate}
                        disabled={isReactivating}
                        className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/25"
                      >
                        {isReactivating ? 'Cargando...' : 'Reactivar'}
                      </button>
                    </>
                  )}
                </div>
              </div>
  )
}
