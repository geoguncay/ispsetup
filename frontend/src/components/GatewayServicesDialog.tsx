import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Settings2, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import api from '@/services/api'

const settingsSchema = z.object({
  security_mode: z.enum(['none_api', 'ppp_api', 'hotspot_api', 'ppp_radius', 'hotspot_radius']),
  traffic_accounting: z.enum(['traffic_flow', 'accounting_v6']),
  speed_control_type: z.enum(['pcq_addresslist', 'simple_queues', 'dhcp_lease_dynamic', 'none']),
})

type GatewaySettingsForm = z.infer<typeof settingsSchema>

interface GatewayServicesDialogProps {
  open: boolean
  onClose: () => void
  gateway: {
    id: string
    name: string
    security_mode?: GatewaySettingsForm['security_mode']
    traffic_accounting?: GatewaySettingsForm['traffic_accounting']
    speed_control_type?: GatewaySettingsForm['speed_control_type']
    settings_configured?: boolean
  }
  onSuccess: () => void
}

export function GatewayServicesDialog({ open, onClose, gateway, onSuccess }: GatewayServicesDialogProps) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, reset } = useForm<GatewaySettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      security_mode: 'none_api',
      traffic_accounting: 'traffic_flow',
      speed_control_type: 'simple_queues',
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        security_mode: gateway.security_mode ?? 'none_api',
        traffic_accounting: gateway.traffic_accounting ?? 'traffic_flow',
        speed_control_type: gateway.speed_control_type ?? 'simple_queues',
      })
    }
  }, [gateway, open, reset])

  const saveMutation = useMutation({
    mutationFn: async (values: GatewaySettingsForm) => {
      await api.put(`/gateways/${gateway.id}/settings`, values)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', gateway.id] })
      queryClient.invalidateQueries({ queryKey: ['gateways'] })
      onSuccess()
      onClose()
    },
  })

  if (!open) return null

  const errorDetail = (saveMutation.error as { response?: { data?: { detail?: string } } } | null)
    ?.response?.data?.detail

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-xl border border-border/50 animate-fade-in">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-brand-400" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Ajustes de Gateway</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{gateway.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit((values) => saveMutation.mutate(values))}>
          <div className="space-y-5 p-5">
            <div>
              <label htmlFor="gateway-security-mode" className="mb-1.5 block text-sm font-medium text-foreground">
                Seguridad
              </label>
              <select id="gateway-security-mode" {...register('security_mode')} className="input-field cursor-pointer">
                <option value="none_api">Ninguno / Accounting API</option>
                <option value="ppp_api">PPP / Accounting API</option>
                <option value="hotspot_api">Hotspot / Accounting API</option>
                <option value="ppp_radius">PPP / Accounting Radius</option>
                <option value="hotspot_radius">Hotspot / Accounting Radius</option>
              </select>
            </div>

            <div>
              <label htmlFor="gateway-traffic-accounting" className="mb-1.5 block text-sm font-medium text-foreground">
                Registro de tráfico
              </label>
              <select id="gateway-traffic-accounting" {...register('traffic_accounting')} className="input-field cursor-pointer">
                <option value="traffic_flow">Traffic Flow (RouterOS V6.x, V7.x)</option>
                <option value="accounting_v6">Accounting (RouterOS V6.x)</option>
              </select>
            </div>

            <div>
              <label htmlFor="gateway-speed-control" className="mb-1.5 block text-sm font-medium text-foreground">
                Control de Velocidad
              </label>
              <select id="gateway-speed-control" {...register('speed_control_type')} className="input-field cursor-pointer">
                <option value="pcq_addresslist">PCQ + Addresslist</option>
                <option value="simple_queues">Colas Simples (Estáticas)</option>
                <option value="dhcp_lease_dynamic">DHCP Lease (Colas simples Dinámicas)</option>
                <option value="none">Ninguno</option>
              </select>
            </div>

            {saveMutation.isError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {errorDetail ?? 'No se pudo guardar y aplicar la configuración.'}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-border/50 px-5 py-4">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {saveMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
