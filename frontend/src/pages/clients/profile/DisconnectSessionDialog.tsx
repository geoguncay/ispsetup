import { createPortal } from 'react-dom'
import { AlertCircle } from 'lucide-react'

interface DisconnectSessionDialogProps {
  username: string | undefined
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Confirmación para cerrar la sesión PPPoE activa. Se monta solo mientras está abierto. */
export function DisconnectSessionDialog({ username, isPending, onCancel, onConfirm }: DisconnectSessionDialogProps) {
  return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-rose-500/20">
            <div className="flex items-center gap-2.5 text-rose-400 mb-3">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Desconectar sesión activa?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              Se cerrará la sesión PPPoE activa de <strong>{username}</strong>. El cliente podrá reconectarse automáticamente si su equipo sigue configurado.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1 justify-center"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {isPending ? 'Desconectando...' : 'Sí, desconectar'}
              </button>
            </div>
          </div>
        </div>,
    document.body
  )
}
