import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2 } from 'lucide-react'
import api from '@/services/api'
import type { AddToast } from './types'

interface ChangePlanDialogProps {
  clientId: string | undefined
  client: any
  addToast: AddToast
  onClose: () => void
}

/** Asignar o cambiar el plan del cliente. Se monta solo mientras está abierto. */
export function ChangePlanDialog({ clientId: id, client, addToast, onClose }: ChangePlanDialogProps) {
  const queryClient = useQueryClient()
  const [selectedPlanId, setSelectedPlanId] = useState<string>(client.plan_activo?.id ?? '')
  const [changePlanMode, setChangePlanMode] = useState<'immediate' | 'next_period'>('immediate')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Lista de planes disponibles para el dropdown
  const { data: availablePlans = [] } = useQuery({
    queryKey: ['available-plans-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/plans')
      return data
    },
  })

  // Detalle y cálculo (prorrateo) del cambio de plan seleccionado, antes de confirmar
  const { data: planChangePreview, isFetching: isLoadingPlanChangePreview } = useQuery({
    queryKey: ['plan-change-preview', id, selectedPlanId],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/plan-change-preview`, { params: { plan_id: selectedPlanId } })
      return data
    },
    enabled: !!selectedPlanId && !!client?.plan_activo,
  })

  const changePlanMutation = useMutation({
    mutationFn: async ({ planId, mode }: { planId: string; mode: 'immediate' | 'next_period' }) => {
      const { data } = await api.post(`/clients/${id}/assign-plan`, null, { params: { plan_id: planId, mode } })
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      onClose()
      addToast(data?.message || 'Plan actualizado correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al cambiar de plan'
      setErrorMessage(msg)
    }
  })

  const handleAssignPlan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPlanId) return
    changePlanMutation.mutate({ planId: selectedPlanId, mode: client?.plan_activo ? changePlanMode : 'immediate' })
  }

  return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md mx-4 animate-fade-in">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Asignar Plan de Internet</h2>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignPlan} className="p-5 space-y-4">
              {errorMessage && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
                  {errorMessage}
                </div>
              )}

              {client.plan_activo && (
                <div className="bg-secondary/35 border border-border/50 rounded-lg p-3">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Plan actual</span>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{client.plan_activo.name}</span>
                    <span className="text-sm font-mono font-bold text-brand-400">${Number(client.plan_activo.price).toFixed(2)}/mes</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    ↓ {client.plan_activo.speed_down_mbps} Mbps / ↑ {client.plan_activo.speed_up_mbps} Mbps
                  </span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Seleccionar plan de velocidad *</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  required
                  className="input-field cursor-pointer"
                >
                  <option value="">Seleccione un plan</option>
                  {availablePlans.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</option>
                  ))}
                </select>
              </div>

              {selectedPlanId && (!client.plan_activo || selectedPlanId === client.plan_activo.id) && (() => {
                const selectedPlanObj = availablePlans.find((p: any) => p.id === selectedPlanId)
                if (!selectedPlanObj) return null
                return (
                  <div className="bg-brand-500/5 border border-brand-500/20 rounded-lg p-3 space-y-1.5">
                    <span className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider block">Detalle del Plan</span>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-foreground">{selectedPlanObj.name}</span>
                      <span className="font-mono font-bold text-brand-400">${Number(selectedPlanObj.price).toFixed(2)}/mes</span>
                    </div>
                    {(selectedPlanObj.speed_down_mbps !== undefined || selectedPlanObj.speed_up_mbps !== undefined) && (
                      <div className="text-[10px] text-muted-foreground flex gap-3 font-medium">
                        <span>📥 Down: {selectedPlanObj.speed_down_mbps || 0} Mbps</span>
                        <span>📤 Up: {selectedPlanObj.speed_up_mbps || 0} Mbps</span>
                      </div>
                    )}
                  </div>
                )
              })()}

              {client.plan_activo && selectedPlanId && selectedPlanId !== client.plan_activo.id && (
                isLoadingPlanChangePreview ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculando...
                  </div>
                ) : planChangePreview && !planChangePreview.is_same_plan ? (
                  <div className="bg-brand-500/5 border border-brand-500/20 rounded-lg p-3 space-y-1.5">
                    <span className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider block">Detalle del cambio</span>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Nuevo plan</span>
                      <span className="font-mono font-semibold text-foreground">
                        {planChangePreview.new_plan.name} — ${Number(planChangePreview.new_plan.price).toFixed(2)}/mes
                      </span>
                    </div>
                    {changePlanMode === 'immediate' ? (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Días restantes del periodo</span>
                          <span className="font-mono text-foreground">{planChangePreview.days_remaining} de {planChangePreview.days_in_period}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                          <span className="text-muted-foreground">{planChangePreview.immediate_adjustment_amount >= 0 ? 'Cargo de ajuste' : 'Crédito a favor'}</span>
                          <span className={`font-mono font-bold ${planChangePreview.immediate_adjustment_amount >= 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            ${Math.abs(planChangePreview.immediate_adjustment_amount).toFixed(2)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                        <span className="text-muted-foreground">Se facturará desde el próximo periodo</span>
                        <span className="font-mono font-bold text-foreground">${planChangePreview.next_period_amount.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                ) : null
              )}

              {client.plan_activo && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">¿Cuándo aplicar el cambio? *</label>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => setChangePlanMode('immediate')}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        changePlanMode === 'immediate' ? 'border-brand-500 bg-brand-500/10' : 'border-border hover:bg-secondary/40'
                      }`}
                    >
                      <span className="text-sm font-semibold text-foreground block">Cambio inmediato</span>
                      <span className="text-xs text-muted-foreground">
                        Se aplica ahora mismo. Genera una factura de ajuste prorrateada por los días que quedan del periodo actual.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChangePlanMode('next_period')}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        changePlanMode === 'next_period' ? 'border-brand-500 bg-brand-500/10' : 'border-border hover:bg-secondary/40'
                      }`}
                    >
                      <span className="text-sm font-semibold text-foreground block">Al iniciar nuevo periodo</span>
                      <span className="text-xs text-muted-foreground">
                        El cliente conserva su plan y velocidad actuales hasta su próxima factura; ahí se aplica el plan nuevo completo, sin prorrateo.
                      </span>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={changePlanMutation.isPending || !selectedPlanId}
                  className="btn-primary flex-1 justify-center"
                >
                  {changePlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {changePlanMutation.isPending
                    ? 'Procesando...'
                    : client.plan_activo && changePlanMode === 'next_period'
                      ? 'Programar Cambio'
                      : 'Asignar Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
  )
}
