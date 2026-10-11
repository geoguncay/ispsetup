import { createPortal } from 'react-dom'

interface DeleteLoadBalancerDialogProps {
  open: boolean
  error: string | null
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteLoadBalancerDialog({ open, error: deleteError, isPending, onCancel, onConfirm }: DeleteLoadBalancerDialogProps) {
  if (!open) return null

  return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar balanceador?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              El balanceador quedará desactivado y dejará de aparecer en el listado.
            </p>
            {deleteError && (
              <div className="p-3 mb-4 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">{deleteError}</div>
            )}
            <div className="flex gap-3">
              <button onClick={onCancel} className="btn-secondary flex-1 justify-center">
                Cancelar
              </button>
              <button onClick={onConfirm} disabled={isPending} className="btn-destructive flex-1 justify-center">
                {isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>,
    document.body
  )
}
