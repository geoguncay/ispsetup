/**
 * Ajustes de Integraciones — contenedor de la categoría "Integraciones" en SettingsPage.
 * Agrupa ZeroTier y Pasarela de Pago.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, MessageSquare, Save, Loader2 } from 'lucide-react'
import { getSystemSettings, updateIntegrations, type IntegrationSettingsRead } from '@/services/systemSettings'
import { saveButtonClass } from '@/lib/utils'
import { useFormDirty } from '@/hooks/useFormDirty'
import { ZeroTierSettingsSection } from '@/pages/settings/ZeroTierSettingsSection'
import { NmsRadiusSettingsSection } from '@/pages/settings/NmsRadiusSettingsSection'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

// ── Pasarela de Pago ─────────────────────────────────────────────────────
function IntegrationSettingsForm({
  data, onSaved, setStatusMessage,
}: { data: IntegrationSettingsRead; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const { formRef, isDirty, snapshot, checkDirty } = useFormDirty()
  useEffect(() => { snapshot() }, [snapshot])

  const mutation = useMutation({
    mutationFn: updateIntegrations,
    onSuccess: () => {
      onSaved()
      snapshot()
      setStatusMessage({ type: 'success', text: 'Configuración de integraciones guardada.' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar las integraciones.' })
    },
  })

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Plug className="w-5 h-5 text-brand-400" />
            Pasarela de Pago
          </h3>
          <p className="text-muted-foreground text-xs mt-1">
            Credenciales de la pasarela de pago utilizada para cobros en línea.
          </p>
        </div>

        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault()
            const target = e.currentTarget as any
            mutation.mutate({
              pg_api_key: target.pgApiKey.value || null,
              pg_api_secret: target.pgApiSecret.value || undefined,
            })
          }}
          onChange={checkDirty}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">API Key</label>
              <input name="pgApiKey" type="text" defaultValue={data.pg_api_key ?? ''} className="input-field font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                API Secret {data.pg_api_secret_set && <span className="text-emerald-400 normal-case">(configurado)</span>}
              </label>
              <input name="pgApiSecret" type="password" className="input-field font-mono" placeholder={data.pg_api_secret_set ? '••••••••' : ''} />
              <span className="text-[10px] text-muted-foreground block">Deje en blanco para mantener el secreto actual.</span>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-border/50">
            <button type="submit" disabled={mutation.isPending} className={saveButtonClass(isDirty, mutation.isPending)}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {mutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>

      <div className="glass-card p-6 space-y-2">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-brand-400" />
          SMS (Twilio)
        </h3>
        <p className="text-muted-foreground text-xs">
          Las credenciales de Twilio se configuran por variables de entorno del servidor. El envío de
          SMS puede habilitarse o deshabilitarse desde la pestaña de Notificaciones.
        </p>
      </div>
    </div>
  )
}

// ── Contenedor ────────────────────────────────────────────────────────────
export function IntegrationsTab({ isAdmin, setStatusMessage }: { isAdmin: boolean; setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSystemSettings,
    enabled: isAdmin,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-settings'] })

  return (
    <div className="space-y-6 animate-fade-in">
      <NmsRadiusSettingsSection setStatusMessage={setStatusMessage} />
      <ZeroTierSettingsSection setStatusMessage={setStatusMessage} />

      {isLoading || !data ? (
        <div className="glass-card p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <IntegrationSettingsForm data={data.integrations} onSaved={invalidate} setStatusMessage={setStatusMessage} />
      )}
    </div>
  )
}
