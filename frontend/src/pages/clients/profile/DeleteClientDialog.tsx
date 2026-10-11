import { createPortal } from 'react-dom'
import { AlertCircle } from 'lucide-react'

interface DeleteClientDialogProps {
  clientName: string
  error: string | null
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Confirmación de eliminación definitiva del cliente. Se monta solo mientras está abierto. */
export function DeleteClientDialog({ clientName, error: deleteError, isPending, onCancel, onConfirm }: DeleteClientDialogProps) {
  return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-destructive/20">
            <div className="flex items-center gap-2.5 text-destructive mb-3">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Eliminar cliente definitivamente?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              Esta acción es <strong>irreversible</strong> y eliminará al cliente <strong>{clientName}</strong> de la base de datos de manera permanente, junto con todo su historial.
            </p>
            {deleteError && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 mb-4">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive leading-snug">{deleteError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {isPending ? 'Eliminando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>,
    document.body
  )
}
