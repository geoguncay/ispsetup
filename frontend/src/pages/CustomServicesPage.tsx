/**
 * CustomServicesPage — CRUD de Servicios Personalizados.
 */
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Trash2, Edit2, Sliders, Loader2, DollarSign, X, Package, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

interface CustomService {
  id: string
  name: string
  price: number
  description?: string | null
  taxes: number
  recurring: boolean
  active: boolean
  created_at: string
  updated_at: string
}

const serviceSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  description: z.string().max(255).optional().or(z.literal('')),
  price: z.coerce.number().min(0.01, 'Mínimo $0.01'),
  taxes: z.coerce.number().min(0, 'No puede ser negativo').default(0),
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

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema) as any,
  })

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
      taxes: 15.0,
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
      taxes: service.taxes || 0,
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sliders className="w-6 h-6 text-brand-400" />
            Servicios Personalizados
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          {isAdmin && (
            <button
              onClick={openAddDialog}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
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
              <Plus className="w-4 h-4" />
              Agregar primer servicio
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service) => (
            <div key={service.id} className="glass-card p-5 relative overflow-hidden flex flex-col justify-between group hover:border-brand-500/30 transition-all duration-300">
              {/* Card Header */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 bg-brand-900/30 rounded-lg flex items-center justify-center border border-brand-800/40">
                    <Package className="w-5 h-5 text-brand-400" />
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-brand-400 font-mono">${Number(service.price).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground block">
                      {service.recurring ? '/mes' : '/pago único'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-lg font-semibold text-foreground truncate">{service.name}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${service.recurring
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                      }`}>
                      {service.recurring ? 'Recurrente' : 'Único'}
                    </span>
                    <span className={`flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${service.active
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-slate-500/10 border-slate-500/20 text-slate-400'
                      }`}>
                      {service.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground min-h-[40px] mb-4 line-clamp-2">
                  {service.description || 'Sin descripción disponible.'}
                </p>

                {/* Tax info */}
                <div className="bg-secondary/35 p-3 rounded-lg border border-border/50 mb-4 text-xs flex justify-between text-muted-foreground font-mono">
                  <span>Impuesto aplicado (IVA):</span>
                  <span className="font-semibold text-foreground">{service.taxes}%</span>
                </div>
              </div>

              {/* Actions */}
              {isAdmin && (
                <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4 mt-2">
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
      {dialogOpen && (
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

                {/* Impuestos */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Impuestos (IVA %)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="15"
                      {...register('taxes')}
                      className="input-field pr-7 font-mono text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-mono">%</span>
                  </div>
                  {errors.taxes && <p className="text-xs text-destructive mt-1">{errors.taxes.message}</p>}
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
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
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
        </div>
      )}
    </div>
  )
}
