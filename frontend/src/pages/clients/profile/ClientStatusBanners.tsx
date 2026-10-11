import { XCircle, CalendarClock } from 'lucide-react'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import { formatDate, formatTime } from '@/lib/utils'

interface ClientStatusBannersProps {
  client: any
  /** Suspensión activa (la más reciente sin fecha de reactivación). */
  activeSuspension: any
  isReactivating: boolean
  cancelDeferPending: boolean
  cancelReactivationPending: boolean
  onCancelDefer: () => void
  onCancelReactivation: () => void
  onReactivate: () => void
}

/** Banners de suspensión programada, cliente suspendido y reactivación programada. */
export function ClientStatusBanners({
  client, activeSuspension, isReactivating, cancelDeferPending, cancelReactivationPending,
  onCancelDefer, onCancelReactivation, onReactivate,
}: ClientStatusBannersProps) {
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  return (
    <>
              {/* Banner: Suspensión programada */}
              {client.active && client.scheduled_suspension && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <span className="text-xs font-semibold text-amber-300 block">Suspensión programada</span>
                      <span className="text-xs text-amber-400/80">
                        Este cliente será suspendido automáticamente el{' '}
                        <strong className="text-amber-200">
                          {formatDate(client.scheduled_suspension, dateFormat)}
                        </strong>{' '}
                        a las{' '}
                        <strong className="text-amber-200">
                          {formatTime(client.scheduled_suspension, timeFormat)}
                        </strong>.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onCancelDefer}
                    disabled={cancelDeferPending}
                    className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Banner: Cliente suspendido (detalle de la suspensión activa) */}
              {!client.active && activeSuspension && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                    <div>
                      <span className="text-xs font-semibold text-rose-300 block">Cliente suspendido</span>
                      <span className="text-xs text-rose-400/80">
                        Motivo: <strong className="text-rose-200">{activeSuspension.reason}</strong>
                        {' '}— desde el{' '}
                        <strong className="text-rose-200">
                          {formatDate(activeSuspension.suspended_at, dateFormat)}
                        </strong>{' '}
                        a las{' '}
                        <strong className="text-rose-200">
                          {formatTime(activeSuspension.suspended_at, timeFormat)}
                        </strong>
                        {' '}por{' '}
                        <strong className="text-rose-200">{activeSuspension.user_name || 'el sistema (automático)'}</strong>.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onReactivate}
                    disabled={isReactivating}
                    className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 transition-all"
                  >
                    {isReactivating ? 'Reactivando...' : 'Cancelar'}
                  </button>
                </div>
              )}

              {/* Banner: Reactivación programada (suspensión "hasta" una fecha) */}
              {!client.active && client.scheduled_reactivation && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <span className="text-xs font-semibold text-amber-300 block">Reactivación programada</span>
                      <span className="text-xs text-amber-400/80">
                        Este cliente será reactivado automáticamente el{' '}
                        <strong className="text-amber-200">
                          {formatDate(client.scheduled_reactivation, dateFormat)}
                        </strong>{' '}
                        a las{' '}
                        <strong className="text-amber-200">
                          {formatTime(client.scheduled_reactivation, timeFormat)}
                        </strong>.
                        {' '}por{' '}
                        <strong className="text-rose-200">{activeSuspension?.user_name || 'el sistema (automático)'}</strong>.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onCancelReactivation}
                    disabled={cancelReactivationPending}
                    className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              )}
    </>
  )
}
