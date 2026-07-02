import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, Clock, Bell, ClipboardList, X, Plus, Save } from 'lucide-react'
import { updateSuspension, type SuspensionSettings } from '@/services/systemSettings'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

const DEFAULT_MOTIVOS = ['Falta de pago', 'Solicitud del cliente', 'Mantenimiento', 'Incumplimiento de contrato']

export function SuspensionSettingsForm({
  data, onSaved, setStatusMessage,
}: { data: SuspensionSettings; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const [dirty, setDirty] = useState(false)
  const [motivos, setMotivos] = useState<string[]>([])
  const [newMotivo, setNewMotivo] = useState('')

  const mutation = useMutation({
    mutationFn: updateSuspension,
    onSuccess: () => onSaved(),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar la suspensión.' })
    },
  })

  useEffect(() => {
    if (data.suspension_motivos && data.suspension_motivos.length > 0) {
      setMotivos(data.suspension_motivos)
    } else {
      setMotivos(DEFAULT_MOTIVOS)
      mutation.mutate({ suspension_motivos: DEFAULT_MOTIVOS })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.suspension_motivos])

  const handleAddMotivo = (e: React.FormEvent) => {
    e.preventDefault()
    const val = newMotivo.trim()
    if (!val) return
    if (motivos.includes(val)) {
      setStatusMessage({ type: 'error', text: 'Este motivo ya existe.' })
      return
    }
    const updated = [...motivos, val]
    setMotivos(updated)
    mutation.mutate({ suspension_motivos: updated })
    setNewMotivo('')
    setStatusMessage({ type: 'success', text: `Motivo "${val}" agregado.` })
  }

  const handleDeleteMotivo = (val: string) => {
    const updated = motivos.filter((m) => m !== val)
    setMotivos(updated)
    mutation.mutate({ suspension_motivos: updated })
    setStatusMessage({ type: 'success', text: 'Motivo eliminado.' })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Ban className="w-5 h-5 text-brand-400" />
          Políticas de Suspensión de Servicio
        </h3>
        <p className="text-muted-foreground text-xs mt-1">
          Configura los motivos disponibles para suspensiones manuales y define las reglas de suspensión automática por falta de pago.
        </p>
      </div>

      {/* Tarjeta: Motivos */}
      <div className="glass-card p-5 border border-border/60 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
            <ClipboardList className="w-4 h-4" /> Motivos de Suspensión Manual
          </div>
          <span className="text-[10px] text-muted-foreground bg-secondary/40 px-2 py-0.5 rounded-full border border-border/40">
            {motivos.length} configurados
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Razones que aparecerán como opciones en el modal al suspender manualmente un servicio.
        </p>

        {motivos.length === 0 ? (
          <p className="text-xs text-muted-foreground italic p-3 text-center border border-dashed border-border/50 rounded-lg">
            No hay motivos configurados. Agrega al menos uno.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {motivos.map((motivo) => (
              <div key={motivo} className="group flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg bg-secondary/40 border border-border/60 text-sm text-foreground hover:border-destructive/40 transition-colors">
                <span>{motivo}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteMotivo(motivo)}
                  className="text-muted-foreground hover:text-destructive transition-colors opacity-40 group-hover:opacity-100"
                  title="Eliminar motivo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddMotivo} className="flex gap-2 pt-1">
          <input
            type="text"
            value={newMotivo}
            onChange={(e) => setNewMotivo(e.target.value)}
            placeholder="Agregar nuevo motivo..."
            className="input-field flex-1 text-sm"
          />
          <button
            type="submit"
            disabled={!newMotivo.trim()}
            className="btn-primary px-3 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Grid: Temporización + Notificaciones */}
      <form
        key={data ? 'loaded' : 'loading'}
        onSubmit={(e) => {
          e.preventDefault()
          const target = e.currentTarget as any
          mutation.mutate({
            suspension_automatica: target.suspensionAutomatica.checked,
            suspension_hora: parseInt(target.horaSuspension.value, 10),
            suspension_retraso_dias: parseInt(target.retrasoDias.value, 10),
            suspension_permitir_aplazamiento: target.permitirAplazamiento.checked,
            suspension_notify_suspendido: target.notifySuspendido.checked,
            suspension_notify_pospuesto: target.notifyPospuesto.checked,
          })
          setDirty(false)
          setStatusMessage({ type: 'success', text: 'Políticas de suspensión actualizadas correctamente.' })
        }}
        onChange={() => setDirty(true)}
        className="space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Tarjeta: Temporización y Automatización */}
          <div className="glass-card p-5 border border-border/60 space-y-5">
            <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
              <Clock className="w-4 h-4" /> Temporización y Automatización
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Hora de corte (24h)
                </label>
                <input
                  name="horaSuspension"
                  type="number"
                  min="0"
                  max="23"
                  defaultValue={String(data.suspension_hora ?? 0)}
                  className="input-field font-mono"
                  placeholder="0"
                />
                <span className="text-[11px] text-muted-foreground block">
                  Hora en la que se ejecutará la suspensión.
                </span>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Días de gracia
                </label>
                <input
                  name="retrasoDias"
                  type="number"
                  min="0"
                  defaultValue={String(data.suspension_retraso_dias ?? 0)}
                  className="input-field font-mono"
                  placeholder="0"
                />
                <span className="text-[11px] text-muted-foreground block">
                  Días extra tras el vencimiento antes de suspender.
                </span>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-border/40">
              <div className="flex items-start gap-3">
                <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0 mt-0.5">
                  <input name="suspensionAutomatica" type="checkbox" defaultChecked={data.suspension_automatica ?? true} className="sr-only peer" />
                  <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-foreground block">Suspensión automática por vencimiento</span>
                  <span className="text-xs text-muted-foreground">Suspende servicios con facturas vencidas de forma automática (se puede anular por cliente).</span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0 mt-0.5">
                  <input name="permitirAplazamiento" type="checkbox" defaultChecked={data.suspension_permitir_aplazamiento ?? true} className="sr-only peer" />
                  <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-foreground block">Permitir aplazamiento</span>
                  <span className="text-xs text-muted-foreground">Muestra la opción de aplazar la suspensión hasta una fecha específica al gestionar un cliente.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tarjeta: Notificaciones */}
          <div className="glass-card p-5 border border-border/60 space-y-5">
            <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
              <Bell className="w-4 h-4" /> Notificaciones de Suspensión
            </div>
            <p className="text-xs text-muted-foreground">
              Configura cuándo enviar notificaciones automáticas por correo electrónico al cliente.
            </p>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/20 border border-border/40">
                <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0 mt-0.5">
                  <input name="notifySuspendido" type="checkbox" defaultChecked={data.suspension_notify_suspendido ?? true} className="sr-only peer" />
                  <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-foreground block">Al suspender el servicio</span>
                  <span className="text-xs text-muted-foreground">Notifica al cliente cuando su servicio ha sido suspendido.</span>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/20 border border-border/40">
                <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0 mt-0.5">
                  <input name="notifyPospuesto" type="checkbox" defaultChecked={data.suspension_notify_pospuesto ?? true} className="sr-only peer" />
                  <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                </label>
                <div>
                  <span className="text-sm font-medium text-foreground block">Al posponer la suspensión</span>
                  <span className="text-xs text-muted-foreground">Notifica al cliente cuando la suspensión ha sido aplazada manualmente desde el panel.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className={dirty ? 'btn-primary' : 'btn-secondary'}>
            <Save className="w-4 h-4" />
            Guardar Políticas
          </button>
        </div>
      </form>
    </div>
  )
}
