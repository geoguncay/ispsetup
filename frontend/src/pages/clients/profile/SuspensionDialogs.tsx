import { createPortal } from 'react-dom'
import { X, Ban, CalendarClock, Loader2 } from 'lucide-react'
import { toDatetimeLocalValue } from '@/lib/utils'
import type { ClientSuspension } from './useClientSuspension'

interface SuspensionDialogsProps {
  client: any
  suspension: ClientSuspension
}

/** Diálogos del flujo de suspensión: suspender, aplazar, reactivación y confirmaciones. */
export function SuspensionDialogs({ client, suspension }: SuspensionDialogsProps) {
  const {
    suspendOpen, setSuspendOpen, deferOpen, setDeferOpen,
    confirmCancelDeferOpen, setConfirmCancelDeferOpen,
    confirmCancelReactivationOpen, setConfirmCancelReactivationOpen,
    deferReactivationOpen, setDeferReactivationOpen,
    deferReactivationDate, setDeferReactivationDate,
    suspensionReason, setSuspensionReason, suspensionReasons,
    deferDate, setDeferDate, suspendUntilMode, setSuspendUntilMode,
    suspendUntilDate, setSuspendUntilDate,
    suspendClientMutation, deferClientMutation, cancelDeferMutation,
    cancelScheduledReactivationMutation, deferReactivationMutation,
  } = suspension

  return (
    <>
      {/* Modal Confirmar Cancelación de Suspensión Programada */}
      {confirmCancelDeferOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            <div className="flex items-center gap-2.5 text-amber-400 mb-3">
              <CalendarClock className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Cancelar la suspensión programada?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              El cliente <strong>{client.full_name}</strong> permanecerá activo, sin una fecha de suspensión pendiente.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancelDeferOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelDeferMutation.mutate(undefined, { onSuccess: () => setConfirmCancelDeferOpen(false) })
                }}
                disabled={cancelDeferMutation.isPending}
                className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
              >
                {cancelDeferMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {cancelDeferMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Confirmar Cancelación de Reactivación Programada */}
      {confirmCancelReactivationOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            <div className="flex items-center gap-2.5 text-amber-400 mb-3">
              <CalendarClock className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Cancelar la reactivación programada?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              El cliente <strong>{client.full_name}</strong> permanecerá suspendido indefinidamente, sin una fecha de reactivación pendiente.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancelReactivationOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelScheduledReactivationMutation.mutate(undefined, { onSuccess: () => setConfirmCancelReactivationOpen(false) })
                }}
                disabled={cancelScheduledReactivationMutation.isPending}
                className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
              >
                {cancelScheduledReactivationMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {cancelScheduledReactivationMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Suspender Servicio */}
      {suspendOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-rose-500/20">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5 text-rose-400">
                <Ban className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Suspender Servicio</h2>
              </div>
              <button
                type="button"
                onClick={() => setSuspendOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selector de duración */}
            <div className="flex gap-1 p-4 pb-0">
              <button
                type="button"
                onClick={() => setSuspendUntilMode('indefinido')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  suspendUntilMode === 'indefinido'
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                    : 'bg-secondary/30 border-border/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Ban className="w-3.5 h-3.5" />
                Suspender
              </button>
              <button
                type="button"
                onClick={() => setSuspendUntilMode('hasta')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  suspendUntilMode === 'hasta'
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                    : 'bg-secondary/30 border-border/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Suspender hasta
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!suspensionReason.trim()) return
                if (suspendUntilMode === 'hasta') {
                  if (!suspendUntilDate) return
                  suspendClientMutation.mutate({ reason: suspensionReason, reactivateAt: new Date(suspendUntilDate).toISOString() })
                } else {
                  suspendClientMutation.mutate({ reason: suspensionReason })
                }
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                {suspendUntilMode === 'hasta'
                  ? <>El servicio de <strong>{client.full_name}</strong> será suspendido inmediatamente y se reactivará automáticamente en la fecha indicada.</>
                  : <>El servicio de <strong>{client.full_name}</strong> será suspendido inmediatamente.</>
                }
              </p>

              {/* Fecha de reactivación (solo en modo "hasta") */}
              {suspendUntilMode === 'hasta' && (
                <div>
                  <label htmlFor="suspend-until-date" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Reactivar el
                  </label>
                  <input
                    id="suspend-until-date"
                    type="datetime-local"
                    value={suspendUntilDate}
                    onChange={(e) => setSuspendUntilDate(e.target.value)}
                    required
                    min={toDatetimeLocalValue(new Date(Date.now() + 60000))}
                    className="input-field font-mono cursor-pointer"
                  />
                </div>
              )}

              {/* Motivo */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Motivo
                </label>
                <select
                  value={suspensionReason}
                  onChange={(e) => setSuspensionReason(e.target.value)}
                  required
                  className="input-field cursor-pointer"
                >
                  <option value="">— Seleccione un motivo —</option>
                  {suspensionReasons.map((motivo) => (
                    <option key={motivo} value={motivo}>{motivo}</option>
                  ))}
                </select>
                {suspensionReasons.length === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    No hay motivos configurados. Ve a Ajustes → Facturación → Suspensión para agregarlos.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSuspendOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    suspendClientMutation.isPending ||
                    !suspensionReason.trim() ||
                    (suspendUntilMode === 'hasta' && !suspendUntilDate)
                  }
                  className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-rose-600 hover:bg-rose-700 text-white border border-rose-700"
                >
                  {suspendClientMutation.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {suspendClientMutation.isPending
                    ? 'Procesando...'
                    : suspendUntilMode === 'hasta' ? 'Suspender Hasta Fecha' : 'Suspender Ahora'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Aplazar Suspensión */}
      {deferOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5 text-amber-400">
                <CalendarClock className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Aplazar Suspensión</h2>
              </div>
              <button
                type="button"
                onClick={() => setDeferOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!suspensionReason.trim() || !deferDate) return
                deferClientMutation.mutate({ deferUntil: new Date(deferDate).toISOString(), reason: suspensionReason })
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                El servicio de <strong>{client.full_name}</strong> permanecerá activo hasta la fecha seleccionada, momento en que se suspenderá automáticamente.
              </p>

              {/* Fecha de aplazamiento */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Aplazar hasta
                </label>
                <input
                  type="datetime-local"
                  value={deferDate}
                  onChange={(e) => setDeferDate(e.target.value)}
                  required
                  min={toDatetimeLocalValue(new Date(Date.now() + 60000))}
                  className="input-field font-mono cursor-pointer"
                />
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Motivo
                </label>
                <select
                  value={suspensionReason}
                  onChange={(e) => setSuspensionReason(e.target.value)}
                  required
                  className="input-field cursor-pointer"
                >
                  <option value="">— Seleccione un motivo —</option>
                  {suspensionReasons.map((motivo) => (
                    <option key={motivo} value={motivo}>{motivo}</option>
                  ))}
                </select>
                {suspensionReasons.length === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    No hay motivos configurados. Ve a Ajustes → Facturación → Suspensión para agregarlos.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeferOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deferClientMutation.isPending || !suspensionReason.trim() || !deferDate}
                  className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
                >
                  {deferClientMutation.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {deferClientMutation.isPending ? 'Procesando...' : 'Programar Suspensión'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Aplazar Reactivación (cliente ya suspendido) */}
      {deferReactivationOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5 text-amber-400">
                <CalendarClock className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Aplazar Reactivación</h2>
              </div>
              <button
                type="button"
                onClick={() => setDeferReactivationOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!deferReactivationDate) return
                deferReactivationMutation.mutate(new Date(deferReactivationDate).toISOString())
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                El servicio de <strong>{client.full_name}</strong> permanecerá suspendido y se reactivará automáticamente en la fecha indicada.
              </p>

              {/* Fecha de reactivación */}
              <div>
                <label htmlFor="defer-reactivation-date" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Reactivar el
                </label>
                <input
                  id="defer-reactivation-date"
                  type="datetime-local"
                  value={deferReactivationDate}
                  onChange={(e) => setDeferReactivationDate(e.target.value)}
                  required
                  min={toDatetimeLocalValue(new Date(Date.now() + 60000))}
                  className="input-field font-mono cursor-pointer"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeferReactivationOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deferReactivationMutation.isPending || !deferReactivationDate}
                  className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
                >
                  {deferReactivationMutation.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {deferReactivationMutation.isPending ? 'Procesando...' : 'Programar Reactivación'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
