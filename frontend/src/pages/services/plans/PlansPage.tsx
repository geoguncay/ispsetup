/**
 * PlansPage — CRUD de Planes de ancho de banda.
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Trash2, Edit2, Zap, ArrowDown, ArrowUp, Loader2, X, PlusCircle, SlidersHorizontal, Gauge } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { getFiscalSettings } from '@/services/systemSettings'
import { computePriceBreakdown } from '@/lib/pricing'

interface Plan {
  id: string
  name: string
  speed_down_mbps: number
  speed_up_mbps: number
  price: number
  created_at: string
  speed_down_kbps?: number
  speed_up_kbps?: number
  description?: string
  limit_at_down_kbps?: number | null
  limit_at_up_kbps?: number | null
  burst_threshold_down_kbps?: number | null
  burst_threshold_up_kbps?: number | null
  priority?: number | null
  address_list?: string | null
  parent?: string | null
  fup_enabled?: boolean
  fup_threshold_gb?: number | null
  fup_reduction_type?: 'percentage' | 'fixed' | null
  fup_reduction_percent?: number | null
  fup_reduction_down_kbps?: number | null
  fup_reduction_up_kbps?: number | null
  active_clients?: number
  suspended_clients?: number
}

const optionalNumber = z.coerce.number().min(0).optional().nullable().or(z.literal('').transform(() => null))

const planSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().max(255).optional().or(z.literal('')),
  price: z.coerce.number().min(0.01, 'Mínimo $0.01'),
  speed_down_kbps: z.coerce.number().min(1, 'Mínimo 1 Kbps'),
  speed_up_kbps: z.coerce.number().min(1, 'Mínimo 1 Kbps'),
  limit_at_down_kbps: optionalNumber,
  limit_at_up_kbps: optionalNumber,
  burst_threshold_down_kbps: optionalNumber,
  burst_threshold_up_kbps: optionalNumber,
  priority: z.coerce.number().min(1).max(8).default(8).optional().nullable(),
  fup_enabled: z.boolean().default(false),
  fup_threshold_gb: optionalNumber,
  fup_reduction_type: z.enum(['percentage', 'fixed']).optional().nullable(),
  fup_reduction_percent: optionalNumber,
  fup_reduction_down_kbps: optionalNumber,
  fup_reduction_up_kbps: optionalNumber,
}).superRefine((data, ctx) => {
  if (!data.fup_enabled) return
  if (!data.fup_threshold_gb || data.fup_threshold_gb <= 0) {
    ctx.addIssue({ path: ['fup_threshold_gb'], code: z.ZodIssueCode.custom, message: 'Ingresa el consumo (GB) que activa la reducción' })
  }
  if (!data.fup_reduction_type) {
    ctx.addIssue({ path: ['fup_reduction_type'], code: z.ZodIssueCode.custom, message: 'Selecciona cómo se reduce la ancho de banda' })
  } else if (data.fup_reduction_type === 'percentage') {
    if (!data.fup_reduction_percent || data.fup_reduction_percent <= 0) {
      ctx.addIssue({ path: ['fup_reduction_percent'], code: z.ZodIssueCode.custom, message: 'Ingresa el porcentaje de reducción' })
    }
  } else if (data.fup_reduction_type === 'fixed') {
    if (!data.fup_reduction_down_kbps && !data.fup_reduction_up_kbps) {
      ctx.addIssue({ path: ['fup_reduction_down_kbps'], code: z.ZodIssueCode.custom, message: 'Ingresa al menos una velocidad reducida' })
    }
  }
})

type PlanFormData = z.infer<typeof planSchema>

async function fetchPlans(): Promise<Plan[]> {
  const { data } = await api.get('/plans')
  return data
}

const toggleClass = "w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"

export function PlansPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

  const [dialogOpen, setDialogOpen] = useState(false)
  const [advancedModalOpen, setAdvancedModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null)

  const { data: plans = [], isLoading} = useQuery({
    queryKey: ['plans'],
    queryFn: fetchPlans,
  })

  const { data: fiscalSettings } = useQuery({
    queryKey: ['fiscal-settings'],
    queryFn: getFiscalSettings,
  })
  const taxRate = fiscalSettings?.fiscal_tax_rate ?? 0
  const taxName = fiscalSettings?.fiscal_tax_name || 'IVA'
  const priceMode = fiscalSettings?.billing_price_mode

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<PlanFormData>({
    resolver: zodResolver(planSchema) as any
  })

  const watchPrice = watch('price')
  const watchDownKbps = watch('speed_down_kbps')
  const watchUpKbps = watch('speed_up_kbps')
  const watchFupEnabled = watch('fup_enabled')
  const watchFupReductionType = watch('fup_reduction_type')
  const watchFupReductionPercent = watch('fup_reduction_percent')

  const priceBreakdown = computePriceBreakdown(Number(watchPrice) || 0, taxRate, priceMode)
  const priceTotal = priceBreakdown.total

  const formatKbpsHelper = (kbpsVal: any) => {
    const num = Number(kbpsVal)
    if (isNaN(num) || num <= 0) return '0 Mbps'
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)} Gbps`
    }
    return `${(num / 1000).toFixed(2)} Mbps`
  }

  const saveMutation = useMutation({
    mutationFn: async (data: PlanFormData) => {
      if (editingPlan) {
        await api.put(`/plans/${editingPlan.id}`, data)
      } else {
        await api.post('/plans', data)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] })
      setDialogOpen(false)
      setEditingPlan(null)
      reset()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al guardar el plan'
      setErrorMessage(msg)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/plans/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] })
      setConfirmDelete(null)
      setDeleteErrorMessage(null)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'No se puede eliminar este plan'
      setDeleteErrorMessage(msg)
    }
  })

  const openAddDialog = () => {
    setEditingPlan(null)
    setErrorMessage(null)
    reset({
      name: '',
      description: '',
      price: 15.0,
      speed_down_kbps: 20000,
      speed_up_kbps: 10000,
      limit_at_down_kbps: null,
      limit_at_up_kbps: null,
      burst_threshold_down_kbps: null,
      burst_threshold_up_kbps: null,
      priority: 8,
      fup_enabled: false,
      fup_threshold_gb: null,
      fup_reduction_type: null,
      fup_reduction_percent: null,
      fup_reduction_down_kbps: null,
      fup_reduction_up_kbps: null,
    })
    setDialogOpen(true)
  }

  const openEditDialog = (plan: Plan) => {
    setEditingPlan(plan)
    setErrorMessage(null)
    reset({
      name: plan.name,
      description: plan.description || '',
      price: plan.price,
      speed_down_kbps: plan.speed_down_kbps || (plan.speed_down_mbps * 1000),
      speed_up_kbps: plan.speed_up_kbps || (plan.speed_up_mbps * 1000),
      limit_at_down_kbps: plan.limit_at_down_kbps,
      limit_at_up_kbps: plan.limit_at_up_kbps,
      burst_threshold_down_kbps: plan.burst_threshold_down_kbps,
      burst_threshold_up_kbps: plan.burst_threshold_up_kbps,
      priority: plan.priority || 8,
      fup_enabled: plan.fup_enabled || false,
      fup_threshold_gb: plan.fup_threshold_gb ?? null,
      fup_reduction_type: plan.fup_reduction_type ?? null,
      fup_reduction_percent: plan.fup_reduction_percent ?? null,
      fup_reduction_down_kbps: plan.fup_reduction_down_kbps ?? null,
      fup_reduction_up_kbps: plan.fup_reduction_up_kbps ?? null,
    })
    setDialogOpen(true)
  }

  const hasAdvancedConfig = (values: Pick<Plan, 'limit_at_down_kbps' | 'limit_at_up_kbps' | 'burst_threshold_down_kbps' | 'burst_threshold_up_kbps' | 'priority'> | null) => {
    if (!values) return false
    const isPositive = (v: unknown) => { const n = Number(v); return !isNaN(n) && n > 0 }
    return Boolean(
      isPositive(values.limit_at_down_kbps) || isPositive(values.limit_at_up_kbps) ||
      isPositive(values.burst_threshold_down_kbps) || isPositive(values.burst_threshold_up_kbps) ||
      (values.priority && Number(values.priority) !== 8)
    )
  }

  const formatFupSummary = (plan: Plan): string | null => {
    if (!plan.fup_enabled || !plan.fup_threshold_gb) return null
    if (plan.fup_reduction_type === 'percentage' && plan.fup_reduction_percent) {
      return `Reduce al ${plan.fup_reduction_percent}% tras ${plan.fup_threshold_gb} GB`
    }
    if (plan.fup_reduction_type === 'fixed' && (plan.fup_reduction_down_kbps || plan.fup_reduction_up_kbps)) {
      const down = plan.fup_reduction_down_kbps ? formatKbpsHelper(plan.fup_reduction_down_kbps) : '—'
      const up = plan.fup_reduction_up_kbps ? formatKbpsHelper(plan.fup_reduction_up_kbps) : '—'
      return `Reduce a ↓${down} / ↑${up} tras ${plan.fup_threshold_gb} GB`
    }
    return `Reduce velocidad tras ${plan.fup_threshold_gb} GB`
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando planes...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-cyan-400 animate-pulse" />
            Planes de Ancho de Banda
          </h1>
        </div>
          {isAdmin && (
            <button
              onClick={openAddDialog}
              className="w-full sm:w-auto bg-primary hover:bg-primary-hover text-primary-foreground font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Agregar plan
            </button>
          )}
      </div>

      {/* Grid of plans */}
      {plans.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin planes registrados</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Agrega tu primer plan de internet para comenzar a registrar clientes.
          </p>
          {isAdmin && (
            <button onClick={openAddDialog} className="btn-primary mx-auto">
              <PlusCircle className="w-4 h-4" />
              Agregar primer plan
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.id} className="glass-card relative overflow-hidden flex flex-col justify-between group hover:border-brand-500/30 hover:-translate-y-0.5 transition-all duration-300">
              <div className="h-[3px] w-full bg-gradient-to-r from-brand-500 to-brand-400/40" />

              <div className="p-5 flex-1 flex flex-col">
                {/* Card Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 shrink-0 bg-brand-900/30 rounded-lg flex items-center justify-center border border-brand-800/40">
                      <Zap className="w-4.5 h-4.5 text-brand-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-foreground truncate leading-tight">{plan.name}</h3>
                      {(hasAdvancedConfig(plan) || plan.fup_enabled) && (
                        <div className="flex items-center gap-1 mt-1">
                          {hasAdvancedConfig(plan) && (
                            <span className="text-[10px] font-medium px-1.5 py-[1px] rounded border border-brand-500/25 text-brand-400" title="Limit At, Burst Threshold o Prioridad configurados">
                              Avanzado
                            </span>
                          )}
                          {plan.fup_enabled && (
                            <span className="text-[10px] font-medium px-1.5 py-[1px] rounded border border-amber-500/25 text-amber-400" title="Reducción de ancho de banda por consumo activa">
                              FUP
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    {(() => {
                      const b = computePriceBreakdown(plan.price, taxRate, priceMode)
                      return (
                        <>
                          <div className="text-xl font-bold text-brand-400 font-mono leading-none">${b.total.toFixed(2)}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-1">
                            {priceMode === 'excluded' ? `$${b.subtotal.toFixed(2)} + ${taxRate}% IVA` : `IVA incluido: $${b.taxAmount.toFixed(2)}`}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* Speeds */}
                <div className="flex items-center rounded-lg border border-border/50 divide-x divide-border/50 mb-3 overflow-hidden">
                  <div className="flex-1 flex items-center gap-2 p-2.5">
                    <ArrowDown className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-none mb-1">Bajada</p>
                      <p className="text-sm font-semibold text-foreground font-mono leading-none">{plan.speed_down_mbps} Mbps</p>
                    </div>
                  </div>
                  <div className="flex-1 flex items-center gap-2 p-2.5">
                    <ArrowUp className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-none mb-1">Subida</p>
                      <p className="text-sm font-semibold text-foreground font-mono leading-none">{plan.speed_up_mbps} Mbps</p>
                    </div>
                  </div>
                </div>

                {/* Clientes Activos/Suspendidos */}
                <div className="gap-3 text-[15px] mb-3 px-0.5">
                  <span className="flex items-center gap-1 font-medium text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {plan.active_clients ?? 0} Activos
                  </span>
                  <span className="flex items-center gap-1 font-medium text-amber-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {plan.suspended_clients ?? 0} Suspendidos
                  </span>
                </div>

                {/* Reducción de Ancho de Banda (FUP) */}
                {formatFupSummary(plan) && (
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2 text-[11px] text-amber-400">
                    <Gauge className="w-3.5 h-3.5 shrink-0" />
                    <span>{formatFupSummary(plan)}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {isAdmin && (
                <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-3">
                  <button
                    onClick={() => openEditDialog(plan)}
                    className="btn-secondary py-1.5 px-3 text-xs"
                    title="Editar plan"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(plan.id)
                      setDeleteErrorMessage(null)
                    }}
                    className="btn-destructive py-1.5 px-3 text-xs"
                    title="Eliminar plan"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Add/Edit Plan */}
      {dialogOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-10">
          <div className="glass-card w-full max-w-4xl mx-4 animate-fade-in my-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                {editingPlan ? `Editar: ${editingPlan.name}` : 'Agregar Plan'}
              </h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="p-5 space-y-6">
              {errorMessage && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
                  {errorMessage}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Col 1: Configuración General */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-brand-400 border-b border-border pb-1.5 mb-3">
                    General
                  </h3>

                  {/* Nombre */}
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Nombre del Plan *</label>
                    <input
                      type="text"
                      placeholder="Plan Fibra Hogar 50 Mbps"
                      {...register('name')}
                      className="input-field"
                    />
                    {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
                  </div>

                  {/* Descripción */}
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Descripción</label>
                    <textarea
                      placeholder="Breve descripción del plan..."
                      {...register('description')}
                      rows={3}
                      className="input-field resize-none py-2 text-sm"
                    />
                    {errors.description && <p className="text-xs text-destructive mt-1">{errors.description.message}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Precio */}
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Precio ($ USD) *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-mono">$</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="19.99"
                          {...register('price')}
                          className="input-field pl-7 font-mono text-sm"
                        />
                      </div>
                      {errors.price && <p className="text-xs text-destructive mt-1">{errors.price.message}</p>}
                    </div>

                    {/* Precio Total (calculado con el IVA global, según el modo de precio de Ajustes) */}
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Precio Total</label>
                      <div className="input-field font-mono text-sm flex items-center justify-between bg-secondary/40 cursor-default select-none">
                        <span className="text-foreground">${priceTotal.toFixed(2)}</span>
                        <span className="text-[10px] text-muted-foreground">{taxRate}% {taxName}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {priceMode === 'excluded'
                          ? `El precio ingresado es la base; se le suma el ${taxName}.`
                          : `El precio ingresado ya incluye el ${taxName} (${priceBreakdown.taxAmount.toFixed(2)}).`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Col 2: Configuración de Ancho de Banda */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-brand-400 border-b border-border pb-1.5 mb-3">
                    Ancho de Banda
                  </h3>

                  {/* Down / Up Kbps */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Descarga (Kbps) *</label>
                      <input
                        type="number"
                        placeholder="50000"
                        {...register('speed_down_kbps')}
                        className="input-field font-mono text-sm"
                      />
                      <p className="text-[10px] text-brand-400 mt-1 font-mono">{formatKbpsHelper(watchDownKbps)}</p>
                      {errors.speed_down_kbps && <p className="text-xs text-destructive mt-1">{errors.speed_down_kbps.message}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Subida (Kbps) *</label>
                      <input
                        type="number"
                        placeholder="25000"
                        {...register('speed_up_kbps')}
                        className="input-field font-mono text-sm"
                      />
                      <p className="text-[10px] text-brand-400 mt-1 font-mono">{formatKbpsHelper(watchUpKbps)}</p>
                      {errors.speed_up_kbps && <p className="text-xs text-destructive mt-1">{errors.speed_up_kbps.message}</p>}
                    </div>
                  </div>

                  {/* Botón Avanzado: Limit At, Burst Threshold, Prioridad */}
                  <button
                    type="button"
                    onClick={() => setAdvancedModalOpen(true)}
                    className="btn-secondary w-full justify-center text-xs py-2"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Avanzado
                    {hasAdvancedConfig(watch()) && (
                      <span className="ml-1 w-1.5 h-1.5 rounded-full bg-brand-400" title="Configuración avanzada activa" />
                    )}
                  </button>

                  {/* Ancho de Banda (FUP) */}
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center gap-4">
                      <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                        <input type="checkbox" {...register('fup_enabled')} className="sr-only peer" />
                        <div className={toggleClass}></div>
                      </label>
                      <div>
                        <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                          <Gauge className="w-3.5 h-3.5 text-brand-400" />
                          Reducir Ancho de Banda
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Al superar un consumo determinado dentro del ciclo de facturación mensual, reduce el ancho de banda del cliente.
                        </span>
                      </div>
                    </div>

                    {watchFupEnabled && (
                      <div className="space-y-3 pl-1 pt-1">
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1.5">Consumo que activa la reducción (GB)</label>
                          <input
                            type="number"
                            step="0.1"
                            placeholder="200"
                            {...register('fup_threshold_gb')}
                            className="input-field font-mono text-sm"
                          />
                          {errors.fup_threshold_gb && <p className="text-xs text-destructive mt-1">{errors.fup_threshold_gb.message as string}</p>}
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Se mide sobre el consumo acumulado dentro del ciclo de facturación mensual del cliente; el contador se reinicia en cada ciclo nuevo.
                          </p>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1.5">Tipo de reducción</label>
                          <select {...register('fup_reduction_type')} className="input-field text-sm">
                            <option value="">Selecciona...</option>
                            <option value="percentage" className="bg-background text-foreground">Porcentaje del plan</option>
                            <option value="fixed" className="bg-background text-foreground">Ancho de Banda fija (Kbps)</option>
                          </select>
                          {errors.fup_reduction_type && <p className="text-xs text-destructive mt-1">{errors.fup_reduction_type.message as string}</p>}
                        </div>

                        {watchFupReductionType === 'percentage' && (
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1.5">Reducir al (%) del ancho de banda original</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="1"
                                placeholder="50"
                                {...register('fup_reduction_percent')}
                                className="input-field pr-7 font-mono text-sm"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-mono">%</span>
                            </div>
                            {errors.fup_reduction_percent && <p className="text-xs text-destructive mt-1">{errors.fup_reduction_percent.message as string}</p>}
                            <p className="text-[10px] text-brand-400 mt-1 font-mono">
                              ↓ {formatKbpsHelper((Number(watchDownKbps) || 0) * (Number(watchFupReductionPercent) || 0) / 100)}
                              {'  '}/{'  '}
                              ↑ {formatKbpsHelper((Number(watchUpKbps) || 0) * (Number(watchFupReductionPercent) || 0) / 100)}
                            </p>
                          </div>
                        )}

                        {watchFupReductionType === 'fixed' && (
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-foreground mb-1.5">Descarga (Kbps)</label>
                              <input
                                type="number"
                                placeholder="Opcional"
                                {...register('fup_reduction_down_kbps')}
                                className="input-field font-mono text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-foreground mb-1.5">Subida (Kbps)</label>
                              <input
                                type="number"
                                placeholder="Opcional"
                                {...register('fup_reduction_up_kbps')}
                                className="input-field font-mono text-sm"
                              />
                            </div>
                            {errors.fup_reduction_down_kbps && <p className="text-xs text-destructive mt-1 col-span-2">{errors.fup_reduction_down_kbps.message as string}</p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Acciones */}
              <div className="flex gap-3 border-t border-border/50 pt-4">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="btn-primary flex-1 justify-center"
                >
                  {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saveMutation.isPending ? 'Guardando...' : editingPlan ? 'Guardar cambios' : 'Agregar plan'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal Avanzado: Limit At / Burst Threshold / Prioridad */}
      {dialogOpen && advancedModalOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-10">
          <div className="glass-card w-full max-w-lg mx-4 animate-fade-in my-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <SlidersHorizontal className="w-4.5 h-4.5 text-brand-400" />
                Configuración Avanzada de Ancho de Banda
              </h2>
              <button
                type="button"
                onClick={() => setAdvancedModalOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Limit At */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Limit At</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Descarga (Kbps)</label>
                    <input
                      type="number"
                      placeholder="Opcional"
                      {...register('limit_at_down_kbps')}
                      className="input-field font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Subida (Kbps)</label>
                    <input
                      type="number"
                      placeholder="Opcional"
                      {...register('limit_at_up_kbps')}
                      className="input-field font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Burst Threshold */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Burst Threshold</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Descarga (Kbps)</label>
                    <input
                      type="number"
                      placeholder="Opcional"
                      {...register('burst_threshold_down_kbps')}
                      className="input-field font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Subida (Kbps)</label>
                    <input
                      type="number"
                      placeholder="Opcional"
                      {...register('burst_threshold_up_kbps')}
                      className="input-field font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Prioridad */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Prioridad</label>
                <select
                  {...register('priority')}
                  className="input-field text-sm"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((prio) => (
                    <option key={prio} value={prio} className="bg-background text-foreground">
                      {prio} {prio === 8 ? '(Mín)' : prio === 1 ? '(Máx)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 border-t border-border/50 p-5">
              <button
                type="button"
                onClick={() => setAdvancedModalOpen(false)}
                className="btn-primary flex-1 justify-center"
              >
                Listo
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar plan?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Esta acción no se puede deshacer. Solo se podrá eliminar si el plan no está asignado a clientes activos.
            </p>

            {deleteErrorMessage && (
              <div className="p-3 mb-4 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs animate-fade-in">
                {deleteErrorMessage}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setConfirmDelete(null)
                  setDeleteErrorMessage(null)
                }}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete)}
                disabled={deleteMutation.isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
