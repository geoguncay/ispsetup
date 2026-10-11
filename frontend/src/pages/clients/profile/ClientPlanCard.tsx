import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Wifi, X } from 'lucide-react'
import api from '@/services/api'
import type { AddToast } from './types'

interface ClientPlanCardProps {
  clientId: string | undefined
  client: any
  addToast: AddToast
  onChangePlan: () => void
}

/** Plan contratado, cambio programado y botón para asignar / cambiar plan. */
export function ClientPlanCard({ clientId: id, client, addToast, onChangePlan }: ClientPlanCardProps) {
  const queryClient = useQueryClient()

  // Cancela un cambio de plan programado ("al iniciar nuevo periodo")
  const cancelPendingPlanChangeMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}/pending-plan-change`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Cambio de plan programado cancelado.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al cancelar el cambio programado', 'error')
    }
  })

  return (
          <div className="glass-card p-5 border border-brand-500/10 hover:border-brand-500/20 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Plan Contratado</span>
              <Wifi className="w-4 h-4 text-brand-400" />
            </div>

            {client.plan_activo ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{client.plan_activo.name}</h3>
                  <div className="flex items-baseline gap-1 mt-1 text-2xl font-mono font-bold text-brand-400">
                    <span>${Number(client.plan_activo.price).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground font-normal font-sans">/mes</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50 font-mono text-muted-foreground">
                  <div>Bajada: <span className="text-foreground font-semibold">{client.plan_activo.speed_down_mbps} Mbps</span></div>
                  <div>Subida: <span className="text-foreground font-semibold">{client.plan_activo.speed_up_mbps} Mbps</span></div>
                </div>

                {client.pending_plan && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <span className="text-amber-400">
                      Cambio programado a <strong>{client.pending_plan.name}</strong> al iniciar el próximo periodo.
                    </span>
                    <button
                      onClick={() => cancelPendingPlanChangeMutation.mutate()}
                      disabled={cancelPendingPlanChangeMutation.isPending}
                      className="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-50"
                      title="Cancelar cambio programado"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <button
                  onClick={onChangePlan}
                  className="btn-primary w-full justify-center text-xs py-2"
                >
                  Cambiar Plan
                </button>
              </div>
            ) : (
              <div className="space-y-4 py-2 text-center">
                <p className="text-sm text-muted-foreground">Este cliente no tiene ningún plan activo asignado.</p>
                <button
                  onClick={onChangePlan}
                  className="btn-primary w-full justify-center text-xs py-2"
                >
                  Asignar primer plan
                </button>
              </div>
            )}
          </div>
  )
}
