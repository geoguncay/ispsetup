/**
 * CustomServicesPage — CRUD de Servicios Personalizados.
 */
import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Trash2, Edit2, Sliders, Loader2, X, Package, PlusCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { getFiscalSettings } from '@/services/systemSettings'

interface CustomService {
  id: string
  name: string
  price: number
  description?: string | null
  recurring: boolean
  active: boolean
  created_at: string
  updated_at: string
}

const serviceSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().max(255).optional().or(z.literal('')),
  price: z.coerce.number().min(0.01, 'Mínimo $0.01'),
  recurring: z.boolean().default(true),
  active: z.boolean().default(true),
})

type ServiceFormData = z.infer<typeof serviceSchema>

async function fetchCustomServices(): Promise<CustomService[]> {
  const { data } = await api.get('/custom-services')
  return data
}

export function CustomServicesPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState<CustomService | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null)

  const { data: services = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['custom-services'],
    queryFn: fetchCustomServices,
  })

  const { data: fiscalSettings } = useQuery({
    queryKey: ['fiscal-settings'],
    queryFn: getFiscalSettings,
  })
  const taxRate = fiscalSettings?.fiscal_tax_rate ?? 0
  const taxName = fiscalSettings?.fiscal_tax_name || 'IVA'

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema) as any,
  })

  const watchPrice = watch('price')
  const priceTotal = (Number(watchPrice) || 0) * (1 + Number(taxRate) / 100)

  const saveMutation = useMutation({
    mutationFn: async (data: ServiceFormData) => {
      if (editingService) {
        await api.put(`/custom-services/${editingService.id}`, data)
      } else {
        await api.post('/custom-services', data)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-services'] })
      setDialogOpen(false)
      setEditingService(null)
      reset()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al guardar el servicio'
      setErrorMessage(msg)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/custom-services/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-services'] })
      setConfirmDelete(null)
      setDeleteErrorMessage(null)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'No se puede eliminar este servicio'
      setDeleteErrorMessage(msg)
    }
  })

  const openAddDialog = () => {
    setEditingService(null)
    setErrorMessage(null)
    reset({
      name: '',
      description: '',
      price: 10.0,
      recurring: true,
      active: true,
    })
    setDialogOpen(true)
  }

  const openEditDialog = (service: CustomService) => {
    setEditingService(service)
    setErrorMessage(null)
    reset({
      name: service.name,
      description: service.description || '',
      price: service.price,
      recurring: service.recurring,
      active: service.active,
    })
    setDialogOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span>Cargando servicios personalizados...</span>
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
            <Sliders className="w-6 h-6 text-cyan-400 animate-pulse" />
            Servicios Personalizados
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              onClick={openAddDialog}
              className="w-full sm:w-auto bg-primary hover:bg-primary-hover text-primary-foreground font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Agregar servicio
            </button>
          )}
        </div>
      </div>

      {/* Grid of services */}
      {services.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin servicios registrados</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Agrega tu primer servicio personalizado (ej: Alquiler de Router, Soporte Técnico) para comenzar.
          </p>
          {isAdmin && (
            <button onClick={openAddDialog} className="btn-primary mx-auto">
              <PlusCircle className="w-4 h-4" />
              Agregar primer servicio
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service) => (
            <div key={service.id} className="glass-card relative overflow-hidden flex flex-col justify-between group hover:border-purple-500/30 hover:-translate-y-0.5 transition-all duration-300">
              <div className="h-[3px] w-full bg-gradient-to-r from-purple-500 to-purple-400/40" />

              <div className="p-5">
                {/* Card Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 shrink-0 bg-purple-500/10 rounded-lg flex items-center justify-center border border-purple-500/30">
                      <Package className="w-4.5 h-4.5 text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-foreground truncate leading-tight">{service.name}</h3>
                      <div className="flex items-center gap-1 mt-1">
                        <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded border ${service.recurring
                            ? 'border-blue-500/25 text-blue-400'
                            : 'border-purple-500/25 text-purple-400'
                          }`}>
                          {service.recurring ? 'Recurrente' : 'Único'}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded border ${service.active
                            ? 'border-emerald-500/25 text-emerald-400'
                            : 'border-slate-500/25 text-slate-400'
                          }`}>
                          {service.active ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="text-xl font-bold text-purple-400 font-mono leading-none">${(Number(service.price) * (1 + Number(taxRate) / 100)).toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-1">${Number(service.price).toFixed(2)} + {taxRate}% {taxName}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{service.recurring ? '/mes' : '/pago único'}</div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[32px]">
                  {service.description || 'Sin descripción disponible.'}
                </p>
              </div>

              {/* Actions */}
              {isAdmin && (
                <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-3">
                  <button
                    onClick={() => openEditDialog(service)}
                    className="btn-secondary py-1.5 px-3 text-xs"
                    title="Editar servicio"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(service.id)
                      setDeleteErrorMessage(null)
                    }}
                    className="btn-destructive py-1.5 px-3 text-xs"
                    title="Eliminar servicio"
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

      {/* Modal Add/Edit Service */}
      {dialogOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-10">
          <div className="glass-card w-full max-w-md mx-4 animate-fade-in my-auto">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                {editingService ? `Editar: ${editingService.name}` : 'Agregar Servicio'}
              </h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit((data) => saveMutation.mutate(data))} className="p-5 space-y-4">
              {errorMessage && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
                  {errorMessage}
                </div>
              )}

              {/* Nombre */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Nombre del Servicio *</label>
                <input
                  type="text"
                  placeholder="Alquiler Router AC1200"
                  {...register('name')}
                  className="input-field"
                />
                {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Descripción</label>
                <textarea
                  placeholder="Detalles sobre el servicio personalizado..."
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
                      placeholder="10.00"
                      {...register('price')}
                      className="input-field pl-7 font-mono text-sm"
                    />
                  </div>
                  {errors.price && <p className="text-xs text-destructive mt-1">{errors.price.message}</p>}
                </div>

                {/* Precio Total (calculado con el IVA global) */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Precio Total</label>
                  <div className="input-field font-mono text-sm flex items-center justify-between bg-secondary/40 cursor-default select-none">
                    <span className="text-foreground">${priceTotal.toFixed(2)}</span>
                    <span className="text-[10px] text-muted-foreground">{taxRate}% {taxName}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Incluye el {taxName} configurado en Ajustes → Facturación → Fiscal.
                  </p>
                </div>
              </div>

              {/* Recurrente (Switch/Checkbox) */}
              <div className="flex items-center gap-2.5 py-1.5">
                <input
                  type="checkbox"
                  id="recurring"
                  {...register('recurring')}
                  className="w-4 h-4 rounded bg-secondary/50 border-border text-brand-600 focus:ring-brand-500/50 cursor-pointer"
                />
                <label htmlFor="recurring" className="text-xs font-medium text-foreground cursor-pointer select-none">
                  Servicio Recurrente (Facturación Mensual)
                </label>
              </div>

              {/* Activo (Switch/Checkbox) */}
              <div className="flex items-center gap-2.5 py-1.5">
                <input
                  type="checkbox"
                  id="active"
                  {...register('active')}
                  className="w-4 h-4 rounded bg-secondary/50 border-border text-brand-600 focus:ring-brand-500/50 cursor-pointer"
                />
                <label htmlFor="active" className="text-xs font-medium text-foreground cursor-pointer select-none">
                  Servicio Activo para facturación
                </label>
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
                  {saveMutation.isPending ? 'Guardando...' : editingService ? 'Guardar cambios' : 'Agregar servicio'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar servicio?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Esta acción no se puede deshacer y borrará el servicio del catálogo.
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
