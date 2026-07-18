import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Settings2, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import api from '@/services/api'

const namedResource = z.string().trim().min(1, 'El nombre es obligatorio').max(160)
const resourceTemplate = namedResource.refine((value) => {
  try {
    const rendered = value
      .split('{client_name}').join('Cliente')
      .split('{plan_name}').join('Plan')
      .split('{ip}').join('192.0.2.1')
    return !/[{}]/.test(rendered)
  } catch {
    return false
  }
}, 'Solo se permiten {client_name}, {plan_name} e {ip}')
const settingsSchema = z.object({
  security_mode: z.enum(['none_api', 'ppp_api', 'hotspot_api', 'ppp_radius', 'hotspot_radius']),
  traffic_accounting: z.enum(['traffic_flow', 'accounting_v6', 'queue_accounting', 'none']),
  speed_control_type: z.enum(['pcq_addresslist', 'simple_queues', 'dhcp_lease_dynamic', 'none']),
  resource_config: z.object({
    security: z.object({ suspend_list: namedResource }),
    traffic: z.object({}),
    speed_control: z.object({
      simple_queue_structure: z.enum(['parented', 'standalone']),
      parent_queue: namedResource,
      simple_queue_upload_type: namedResource,
      simple_queue_download_type: namedResource,
      client_address_list: namedResource,
      client_queue_name_template: resourceTemplate,
      dhcp_comment_template: resourceTemplate,
      pcq_upload_type: namedResource,
      pcq_download_type: namedResource,
      upload_packet_mark: namedResource,
      download_packet_mark: namedResource,
      upload_queue_tree: namedResource,
      download_queue_tree: namedResource,
      upload_mangle_comment: namedResource,
      download_mangle_comment: namedResource,
    }),
  }),
})

type GatewaySettingsForm = z.infer<typeof settingsSchema>

const DEFAULT_RESOURCES: GatewaySettingsForm['resource_config'] = {
  security: { suspend_list: 'Suspendidos' },
  traffic: {},
  speed_control: {
    simple_queue_structure: 'parented',
    parent_queue: 'Clientes',
    simple_queue_upload_type: 'default-small',
    simple_queue_download_type: 'default-small',
    client_address_list: 'Clientes',
    client_queue_name_template: '{plan_name} | {client_name}',
    dhcp_comment_template: '{plan_name} | {client_name}',
    pcq_upload_type: 'pcq_upload',
    pcq_download_type: 'pcq_download',
    upload_packet_mark: 'pcq_upload',
    download_packet_mark: 'pcq_download',
    upload_queue_tree: 'pcq_upload',
    download_queue_tree: 'pcq_download',
    upload_mangle_comment: 'ISP PCQ upload',
    download_mangle_comment: 'ISP PCQ download',
  },
}

interface GatewayServicesDialogProps {
  open: boolean
  onClose: () => void
  gateway: {
    id: string
    name: string
    security_mode?: GatewaySettingsForm['security_mode']
    traffic_accounting?: GatewaySettingsForm['traffic_accounting']
    speed_control_type?: GatewaySettingsForm['speed_control_type']
    resource_config?: GatewaySettingsForm['resource_config'] | null
    parent_queue?: string | null
    address_list?: string | null
    suspend_list?: string | null
    ros_version?: string | null
    settings_configured?: boolean
  }
  onSuccess: () => void
}

function resourcesFor(gateway: GatewayServicesDialogProps['gateway']): GatewaySettingsForm['resource_config'] {
  const stored = gateway.resource_config
  return {
    security: {
      ...DEFAULT_RESOURCES.security,
      ...(stored?.security ?? {}),
      ...(!stored && gateway.suspend_list ? { suspend_list: gateway.suspend_list } : {}),
    },
    traffic: {},
    speed_control: {
      ...DEFAULT_RESOURCES.speed_control,
      ...(stored?.speed_control ?? {}),
      ...(!stored && gateway.parent_queue ? { parent_queue: gateway.parent_queue } : {}),
      ...(!stored && gateway.address_list ? { client_address_list: gateway.address_list } : {}),
    },
  }
}

export function GatewayServicesDialog({ open, onClose, gateway, onSuccess }: GatewayServicesDialogProps) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<GatewaySettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      security_mode: 'none_api',
      traffic_accounting: 'traffic_flow',
      speed_control_type: 'simple_queues',
      resource_config: DEFAULT_RESOURCES,
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        security_mode: gateway.security_mode ?? 'none_api',
        traffic_accounting: gateway.traffic_accounting ?? 'traffic_flow',
        speed_control_type: gateway.speed_control_type ?? 'simple_queues',
        resource_config: resourcesFor(gateway),
      })
    }
  }, [gateway, open, reset])

  const saveMutation = useMutation({
    mutationFn: async (values: GatewaySettingsForm) => api.put(`/gateways/${gateway.id}/settings`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', gateway.id] })
      queryClient.invalidateQueries({ queryKey: ['gateways'] })
      onSuccess()
      onClose()
    },
  })

  if (!open) return null

  const speedMode = watch('speed_control_type')
  const simpleQueueStructure = watch('resource_config.speed_control.simple_queue_structure')
  const errorDetail = (saveMutation.error as { response?: { data?: { detail?: string } } } | null)
    ?.response?.data?.detail
  const isRouterOs7 = gateway.ros_version?.trim().startsWith('7.') ?? false
  const fieldError = (message?: string) => message && <p className="mt-1 text-xs text-destructive">{message}</p>
  const input = (name: Parameters<typeof register>[0], label: string, hint?: string) => (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      <input {...register(name)} className="input-field font-mono" />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card flex max-h-[92vh] w-full max-w-3xl flex-col border border-border/50 animate-fade-in">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-brand-400" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Ajustes de Gateway</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{gateway.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit((values) => saveMutation.mutate(values))}>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <section className="rounded-xl border border-border/50 bg-secondary/10 p-4 space-y-4">
              <div>
                <label htmlFor="gateway-security-mode" className="mb-1.5 block text-sm font-semibold text-foreground">Seguridad</label>
                <select id="gateway-security-mode" {...register('security_mode')} className="input-field cursor-pointer">
                  <option value="none_api">Ninguno / Accounting API</option><option value="ppp_api">PPP / Accounting API</option>
                  <option value="hotspot_api">Hotspot / Accounting API</option><option value="ppp_radius">PPP / Accounting Radius</option>
                  <option value="hotspot_radius">Hotspot / Accounting Radius</option>
                </select>
              </div>
              {input('resource_config.security.suspend_list', 'Lista de clientes suspendidos')}
              {fieldError(errors.resource_config?.security?.suspend_list?.message)}
            </section>

            <section className="rounded-xl border border-border/50 bg-secondary/10 p-4 space-y-3">
              <label htmlFor="gateway-traffic-accounting" className="block text-sm font-semibold text-foreground">Registro de tráfico</label>
              <select id="gateway-traffic-accounting" {...register('traffic_accounting')} className="input-field cursor-pointer">
                <option value="traffic_flow">Traffic Flow (RouterOS V6.x, V7.x)</option>
                <option value="accounting_v6" disabled={isRouterOs7}>Accounting (RouterOS V6.x)</option>
                <option value="queue_accounting">Colas / Queue accounting</option><option value="none">Ninguno</option>
              </select>
              <p className="text-[11px] text-muted-foreground">Este modo no crea recursos RouterOS que requieran un nombre adicional.</p>
            </section>

            <section className="rounded-xl border border-border/50 bg-secondary/10 p-4 space-y-4">
              <div>
                <label htmlFor="gateway-speed-control" className="mb-1.5 block text-sm font-semibold text-foreground">Control de velocidad</label>
                <select id="gateway-speed-control" {...register('speed_control_type')} className="input-field cursor-pointer">
                  <option value="pcq_addresslist">PCQ + Address List</option><option value="simple_queues">Colas Simples (Estáticas)</option>
                  <option value="dhcp_lease_dynamic">DHCP Lease (Colas simples dinámicas)</option><option value="none">Ninguno</option>
                </select>
              </div>

              {speedMode === 'simple_queues' && <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">Estructura de las colas</label>
                  <select {...register('resource_config.speed_control.simple_queue_structure')} className="input-field cursor-pointer">
                    <option value="standalone">Colas independientes

                    </option>
                    <option value="parented">Colas con cola padre</option>
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {simpleQueueStructure === 'standalone'
                      ? 'Cada cliente tendrá una cola directa; no se creará ni asignará una cola padre.'
                      : 'Las colas de clientes se crearán como hijas de una cola padre administrada.'}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {input('resource_config.speed_control.simple_queue_upload_type', 'Queue Type de subida', 'Ejemplo: cake, fq-codel o default-small')}
                  {input('resource_config.speed_control.simple_queue_download_type', 'Queue Type de descarga', 'Debe existir previamente en RouterOS')}
                  {input('resource_config.speed_control.client_queue_name_template', 'Plantilla de cola de cliente', 'Variables: {client_name}, {plan_name}, {ip}')}
                  {simpleQueueStructure === 'parented' && input('resource_config.speed_control.parent_queue', 'Nombre de la cola padre')}
                </div>
              </div>}

              {speedMode === 'dhcp_lease_dynamic' && input(
                'resource_config.speed_control.dhcp_comment_template', 'Plantilla de comentario DHCP', 'Variables: {plan_name} |{client_name}, {ip}'
              )}

              {speedMode === 'pcq_addresslist' && <div className="space-y-4">
                {input('resource_config.speed_control.client_address_list', 'Address List de clientes')}
                <div className="grid gap-4 md:grid-cols-2">
                  {input('resource_config.speed_control.pcq_upload_type', 'Tipo PCQ de subida')}
                  {input('resource_config.speed_control.pcq_download_type', 'Tipo PCQ de descarga')}
                  {input('resource_config.speed_control.upload_packet_mark', 'Marca de paquetes de subida')}
                  {input('resource_config.speed_control.download_packet_mark', 'Marca de paquetes de descarga')}
                  {input('resource_config.speed_control.upload_queue_tree', 'Queue Tree de subida')}
                  {input('resource_config.speed_control.download_queue_tree', 'Queue Tree de descarga')}
                  {input('resource_config.speed_control.upload_mangle_comment', 'Comentario Mangle de subida')}
                  {input('resource_config.speed_control.download_mangle_comment', 'Comentario Mangle de descarga')}
                </div>
              </div>}
              {speedMode === 'none' && <p className="text-xs text-muted-foreground">No se crearán colas, reglas PCQ ni límites DHCP.</p>}
            </section>

            {saveMutation.isError && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorDetail ?? 'No se pudo guardar y aplicar la configuración.'}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t border-border/50 px-5 py-4">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {saveMutation.isPending ? 'Guardando…' : 'Guardar y aplicar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
