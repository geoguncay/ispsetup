/**
 * GatewayServicesDialog — Modal dedicado para configurar Servicios y Monitoreo de un gateway.
 */
import { useState, useEffect } from 'react'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  X, Loader2, Activity, Server, Router as GatewayIcon, Hash,
  CheckCircle2, XCircle, Plus,
} from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'

const servicesSchema = z.object({
  bandwidth_up: z.coerce.number().min(0).default(0),
  bandwidth_down: z.coerce.number().min(0).default(0),
  parent_queue: z.string().max(100).optional().nullable(),
  address_list: z.string().max(100).optional().nullable(),
  suspend_list: z.string().max(100).optional().nullable(),
  config_mode: z.enum(['system', 'router']).default('system'),
  traffic_monitoring: z.boolean().default(true),
  speed_control: z.boolean().default(true),
  sync_logs: z.boolean().default(true),
  alert_notifications: z.boolean().default(true),
})

type ServicesFormData = z.infer<typeof servicesSchema>

interface GatewayServicesDialogProps {
  open: boolean
  onClose: () => void
  gateway: {
    id: string
    name: string
    bandwidth_up?: number | null
    bandwidth_down?: number | null
    parent_queue?: string | null
    address_list?: string | null
    suspend_list?: string | null
    config_mode?: string | null
    traffic_monitoring?: boolean
    speed_control?: boolean
    sync_logs?: boolean
    alert_notifications?: boolean
  }
  onSuccess: () => void
}

export function GatewayServicesDialog({ open, onClose, gateway, onSuccess }: GatewayServicesDialogProps) {
  const queryClient = useQueryClient()

  const [configMode, setConfigMode] = useState<'system' | 'router'>('system')
  const [routerQueues, setRouterQueues] = useState<string[]>([])
  const [routerAddressLists, setRouterAddressLists] = useState<string[]>([])
  const [routerFetchState, setRouterFetchState] = useState<'idle' | 'loading' | 'error' | 'loaded'>('idle')

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<ServicesFormData>({
    resolver: zodResolver(servicesSchema) as unknown as Resolver<ServicesFormData>,
    defaultValues: {
      bandwidth_up: 0,
      bandwidth_down: 0,
      config_mode: 'system',
      traffic_monitoring: true,
      speed_control: true,
      sync_logs: true,
      alert_notifications: true,
    },
  })

  useEffect(() => {
    if (open) {
      const mode = (gateway.config_mode === 'router' ? 'router' : 'system') as 'system' | 'router'
      setConfigMode(mode)
      setRouterQueues([])
      setRouterAddressLists([])
      setRouterFetchState('idle')
      reset({
        bandwidth_up: gateway.bandwidth_up ?? 0,
        bandwidth_down: gateway.bandwidth_down ?? 0,
        parent_queue: gateway.parent_queue ?? '',
        address_list: gateway.address_list ?? '',
        suspend_list: gateway.suspend_list ?? '',
        config_mode: mode,
        traffic_monitoring: gateway.traffic_monitoring ?? true,
        speed_control: gateway.speed_control ?? true,
        sync_logs: gateway.sync_logs ?? true,
        alert_notifications: gateway.alert_notifications ?? true,
      })
    }
  }, [open, gateway, reset])

  const fetchRouterResources = async () => {
    setRouterFetchState('loading')
    try {
      const [listsRes, queuesRes] = await Promise.all([
        api.get(`/gateways/${gateway.id}/address-lists`),
        api.get(`/gateways/${gateway.id}/queues`),
      ])
      setRouterAddressLists(listsRes.data as string[])
      setRouterQueues((queuesRes.data as { name: string }[]).map((q) => q.name))
      setRouterFetchState('loaded')
    } catch {
      setRouterFetchState('error')
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (data: ServicesFormData) => {
      await api.put(`/gateways/${gateway.id}`, {
        bandwidth_up: data.bandwidth_up,
        bandwidth_down: data.bandwidth_down,
        parent_queue: data.parent_queue || null,
        address_list: data.address_list || null,
        suspend_list: data.suspend_list || null,
        config_mode: data.config_mode,
        traffic_monitoring: data.traffic_monitoring,
        speed_control: data.speed_control,
        sync_logs: data.sync_logs,
        alert_notifications: data.alert_notifications,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', gateway.id] })
      onSuccess()
      onClose()
    },
  })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-2xl mx-auto animate-fade-in border border-border/50 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-brand-500/15 text-brand-400 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Servicios y Monitoreo</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{gateway.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as ServicesFormData))} className="overflow-y-auto flex-1">
          <div className="p-5 space-y-6">

            {/* Ancho de Banda */}
            <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <Server className="w-4 h-4" /> Recursos y Ancho de Banda
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Límite de Bajada (Mbps)
                  </label>
                  <input
                    type="number"
                    placeholder="Ej. 100 (0 = ilimitado)"
                    {...register('bandwidth_down')}
                    className="input-field font-mono"
                  />
                  {errors.bandwidth_down && <p className="text-xs text-destructive mt-1">{errors.bandwidth_down.message}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Límite de Subida (Mbps)
                  </label>
                  <input
                    type="number"
                    placeholder="Ej. 50 (0 = ilimitado)"
                    {...register('bandwidth_up')}
                    className="input-field font-mono"
                  />
                  {errors.bandwidth_up && <p className="text-xs text-destructive mt-1">{errors.bandwidth_up.message}</p>}
                </div>
              </div>

              {/* Selector de modo */}
              <div>
                <p className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Modo de asignación de colas y listas</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { setConfigMode('system'); setValue('config_mode', 'system') }}
                    className={`text-left p-3.5 rounded-lg border transition-all ${
                      configMode === 'system'
                        ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/40'
                        : 'border-border/50 bg-secondary/10 hover:border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${configMode === 'system' ? 'border-brand-400' : 'border-muted-foreground'}`}>
                        {configMode === 'system' && <div className="w-1.5 h-1.5 rounded-full bg-brand-400" />}
                      </div>
                      <span className="text-sm font-medium text-foreground">Configuración del sistema</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5">Usa los nombres del catálogo. La plataforma crea las colas y listas si no existen.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setConfigMode('router'); setValue('config_mode', 'router') }}
                    className={`text-left p-3.5 rounded-lg border transition-all ${
                      configMode === 'router'
                        ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40'
                        : 'border-border/50 bg-secondary/10 hover:border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${configMode === 'router' ? 'border-amber-400' : 'border-muted-foreground'}`}>
                        {configMode === 'router' && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                      </div>
                      <span className="text-sm font-medium text-foreground">Usar configuración del router</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5">Selecciona colas y listas existentes del router. No se crearán recursos nuevos.</p>
                  </button>
                </div>
              </div>

              {/* Botón cargar del router */}
              {configMode === 'router' && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={routerFetchState === 'loading'}
                    onClick={fetchRouterResources}
                    className="btn-secondary text-xs flex items-center gap-2 px-4 py-2"
                  >
                    {routerFetchState === 'loading' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    {routerFetchState === 'loading' ? 'Cargando desde el router…' : 'Cargar configuración del router'}
                  </button>
                  {routerFetchState === 'loaded' && (
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {routerQueues.length} colas · {routerAddressLists.length} listas
                    </span>
                  )}
                  {routerFetchState === 'error' && (
                    <span className="text-xs text-destructive flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> No se pudo conectar al router
                    </span>
                  )}
                </div>
              )}

              {/* Dropdowns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* Cola Padre */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Cola Padre</label>
                  {configMode === 'router' ? (
                    routerFetchState === 'loaded' ? (
                      <select {...register('parent_queue')} className="input-field font-mono cursor-pointer">
                        <option value="">— Sin cola padre —</option>
                        {routerQueues.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="input-field flex items-center gap-2 text-muted-foreground text-xs italic select-none bg-secondary/20">
                        <GatewayIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        {routerFetchState === 'loading' ? 'Cargando…' : 'Carga la configuración del router'}
                      </div>
                    )
                  ) : (() => {
                    const opts: string[] = JSON.parse(localStorage.getItem('isp_parent_queues') ?? '[]')
                    return opts.length > 0 ? (
                      <select {...register('parent_queue')} className="input-field font-mono cursor-pointer">
                        <option value="">— Sin cola padre —</option>
                        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="input-field flex items-center gap-2 text-muted-foreground text-xs italic select-none bg-secondary/20">
                        <GatewayIcon className="w-3.5 h-3.5 flex-shrink-0" />
                        Sin colas — administra en Ajustes Gateway
                      </div>
                    )
                  })()}
                </div>

                {/* Address List */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Address List de Clientes</label>
                  {configMode === 'router' ? (
                    routerFetchState === 'loaded' ? (
                      <select {...register('address_list')} className="input-field font-mono cursor-pointer">
                        <option value="">— Sin address list —</option>
                        {routerAddressLists.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="input-field flex items-center gap-2 text-muted-foreground text-xs italic select-none bg-secondary/20">
                        <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                        {routerFetchState === 'loading' ? 'Cargando…' : 'Carga la configuración del router'}
                      </div>
                    )
                  ) : (() => {
                    const opts: string[] = JSON.parse(localStorage.getItem('isp_address_lists') ?? '[]')
                    return opts.length > 0 ? (
                      <select {...register('address_list')} className="input-field font-mono cursor-pointer">
                        <option value="">— Sin address list —</option>
                        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="input-field flex items-center gap-2 text-muted-foreground text-xs italic select-none bg-secondary/20">
                        <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                        Sin listas — administra en Ajustes Gateway
                      </div>
                    )
                  })()}
                </div>

                {/* Lista Suspendidos */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1.5">Lista de Suspendidos</label>
                  {configMode === 'router' ? (
                    routerFetchState === 'loaded' ? (
                      <select {...register('suspend_list')} className="input-field font-mono cursor-pointer">
                        <option value="">— Sin lista de suspendidos —</option>
                        {routerAddressLists.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="input-field flex items-center gap-2 text-muted-foreground text-xs italic select-none bg-secondary/20">
                        <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                        {routerFetchState === 'loading' ? 'Cargando…' : 'Carga la configuración del router'}
                      </div>
                    )
                  ) : (() => {
                    const opts: string[] = JSON.parse(localStorage.getItem('isp_suspend_lists') ?? '[]')
                    return opts.length > 0 ? (
                      <select {...register('suspend_list')} className="input-field font-mono cursor-pointer">
                        <option value="">— Default (isp_suspendidos) —</option>
                        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <div className="input-field flex items-center gap-2 text-muted-foreground text-xs italic select-none bg-secondary/20">
                        <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                        Sin listas — administra en Ajustes Gateway
                      </div>
                    )
                  })()}
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    Si no se selecciona, se usa <code>isp_suspendidos</code> por defecto.
                  </span>
                </div>
              </div>
            </div>

            {/* Toggles de Servicios */}
            <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <Activity className="w-4 h-4" /> Servicios Automatizados
              </div>

              {[
                { field: 'traffic_monitoring' as const, label: 'Registro de Tráfico', desc: 'Monitorear y graficar consumo de interfaces' },
                { field: 'speed_control' as const, label: 'Control de Velocidad', desc: 'Administración dinámica de colas (Queues)' },
                { field: 'sync_logs' as const, label: 'Sincronización de Logs', desc: 'Sincronizar eventos del RouterOS al historial ISP' },
                { field: 'alert_notifications' as const, label: 'Notificaciones de Alertas', desc: 'Alertar cuando el gateway cambia de estado' },
              ].map(({ field, label, desc }) => (
                <div key={field} className="flex items-center gap-3 py-2 border-t border-border/30 first:border-t-0 first:pt-0">
                  <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                    <input type="checkbox" {...register(field)} className="sr-only peer" />
                    <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                  </label>
                  <div>
                    <span className="text-sm font-medium text-foreground block">{label}</span>
                    <span className="text-xs text-muted-foreground">{desc}</span>
                  </div>
                </div>
              ))}
            </div>

            {saveMutation.isError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
                <p className="text-sm text-destructive">Error al guardar. Verifica los datos e intenta de nuevo.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-border/50 px-5 py-4 shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
