import { useEffect, useState } from 'react'
import { Database, Loader2, Server, Trash2, X } from 'lucide-react'

type GatewayDeletionChoice = 'preserve_all' | 'remove_routeros' | 'remove_history' | 'remove_all'

export interface GatewayDeletionOptions {
  cleanupRouterOs: boolean
  deleteHistoricalData: boolean
  confirmation?: string
}

interface GatewayDeleteDialogProps {
  open: boolean
  gatewayName: string
  pending: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (options: GatewayDeletionOptions) => void
}

export function GatewayDeleteDialog({
  open,
  gatewayName,
  pending,
  error,
  onClose,
  onConfirm,
}: GatewayDeleteDialogProps) {
  const [choice, setChoice] = useState<GatewayDeletionChoice>('preserve_all')
  const [confirmation, setConfirmation] = useState('')

  useEffect(() => {
    if (open) {
      setChoice('preserve_all')
      setConfirmation('')
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="glass-card flex h-5/6 max-w-6xl animate-fade-in flex-col overflow-hidden border border-border/50">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-5">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Eliminar Gateway</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{gatewayName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Elige por separado qué hacer con la configuración de RouterOS y con la información almacenada en el NMS.
          </p>

          <label className={`block cursor-pointer rounded-xl border p-4 transition-colors ${choice === 'preserve_all' ? 'border-brand-500 bg-brand-500/10' : 'border-border hover:border-border/80'}`}>
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="gateway-deletion"
                checked={choice === 'preserve_all'}
                onChange={() => setChoice('preserve_all')}
                className="mt-1"
              />
              <Server className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" />
              <div>
                <span className="block text-sm font-semibold text-foreground">1. Conservar configuración en RouterOS y datos históricos</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Solo desactiva el Gateway en el NMS. No modifica el MikroTik ni elimina información.
                </span>
              </div>
            </div>
          </label>

          <label className={`block cursor-pointer rounded-xl border p-4 transition-colors ${choice === 'remove_routeros' ? 'border-amber-500 bg-amber-500/10' : 'border-border hover:border-border/80'}`}>
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="gateway-deletion"
                checked={choice === 'remove_routeros'}
                onChange={() => setChoice('remove_routeros')}
                className="mt-1"
              />
              <Server className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <span className="block text-sm font-semibold text-foreground">2. Conservar datos históricos y eliminar configuración en RouterOS</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Conserva la información del NMS y limpia listas, colas, PCQ, PPPoE, Radius y Traffic Flow administrados por el sistema.
                </span>
              </div>
            </div>
          </label>

          <label className={`block cursor-pointer rounded-xl border p-4 transition-colors ${choice === 'remove_history' ? 'border-destructive bg-destructive/10' : 'border-border hover:border-border/80'}`}>
            <div className="flex items-start gap-3">
              <input type="radio" name="gateway-deletion" checked={choice === 'remove_history'} onChange={() => setChoice('remove_history')} className="mt-1" />
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <span className="block text-sm font-semibold text-foreground">3. Conservar configuración en RouterOS y eliminar datos históricos</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  No modifica el MikroTik, pero elimina definitivamente el Gateway, clientes asociados, tráfico, facturas, pagos, tickets y auditorías relacionadas.
                </span>
              </div>
            </div>
          </label>

          <label className={`block cursor-pointer rounded-xl border p-4 transition-colors ${choice === 'remove_all' ? 'border-destructive bg-destructive/10' : 'border-border hover:border-border/80'}`}>
            <div className="flex items-start gap-3">
              <input type="radio" name="gateway-deletion" checked={choice === 'remove_all'} onChange={() => setChoice('remove_all')} className="mt-1" />
              <Trash2 className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <span className="block text-sm font-semibold text-foreground">4. Eliminar datos históricos y configuración en RouterOS</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  Limpia el MikroTik y elimina definitivamente toda la información asociada en el NMS.
                </span>
              </div>
            </div>
          </label>

          {(choice === 'remove_history' || choice === 'remove_all') && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-semibold text-destructive">Esta acción es irreversible</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Escribe <strong className="text-foreground">{gatewayName}</strong> para confirmar la eliminación física de los datos.
              </p>
              <input
                type="text"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={gatewayName}
                className="input-field mt-3"
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-border/50 px-5 py-4">
          <button type="button" onClick={onClose} disabled={pending} className="btn-secondary">Cancelar</button>
          <button
            type="button"
            onClick={() => onConfirm({
              cleanupRouterOs: choice === 'remove_routeros' || choice === 'remove_all',
              deleteHistoricalData: choice === 'remove_history' || choice === 'remove_all',
              confirmation: choice === 'remove_history' || choice === 'remove_all' ? confirmation : undefined,
            })}
            disabled={pending || ((choice === 'remove_history' || choice === 'remove_all') && confirmation !== gatewayName)}
            className="btn-destructive"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending
              ? 'Eliminando…'
              : choice === 'remove_history' || choice === 'remove_all'
                ? 'Eliminar definitivamente'
                : 'Desactivar Gateway'}
          </button>
        </div>
      </div>
    </div>
  )
}
