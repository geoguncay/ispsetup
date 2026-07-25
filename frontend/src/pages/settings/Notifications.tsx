/**
 * Ajustes de Notificaciones  — contenedor de la categoría "Notificaciones" en SettingsPage.
 * Agrupa Notificaciones (SMTP/SMS) y  como sub-pestañas internas.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Save, Loader2 } from 'lucide-react'
import { getSystemSettings, updateNotifications, type SmtpSettingsRead } from '@/services/systemSettings'
import { saveButtonClass } from '@/lib/utils'
import { useFormDirty } from '@/hooks/useFormDirty'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

type SubTab = 'notificaciones'


// ── Notificaciones ───────────────────────────────────────────────────────
function NotificationSettingsForm({
  data, onSaved, setStatusMessage,
}: { data: SmtpSettingsRead; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const { formRef, isDirty, snapshot, checkDirty } = useFormDirty()
  useEffect(() => { snapshot() }, [snapshot])

  const mutation = useMutation({
    mutationFn: updateNotifications,
    onSuccess: () => {
      onSaved()
      snapshot()
      setStatusMessage({ type: 'success', text: 'Configuración de notificaciones guardada.' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar las notificaciones.' })
    },
  })

  return (
    <div className="glass-card p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Bell className="w-5 h-5 text-brand-400" />
          Notificaciones
        </h3>
        <p className="text-muted-foreground text-xs mt-1">
          Configuración del servidor SMTP para correos automáticos. Por ahora solo se guarda la
          configuración; el envío de correos se habilitará en una fase futura.
        </p>
      </div>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault()
          const target = e.currentTarget as any
          mutation.mutate({
            smtp_host: target.smtpHost.value || null,
            smtp_port: target.smtpPort.value ? parseInt(target.smtpPort.value, 10) : null,
            smtp_user: target.smtpUser.value || null,
            smtp_password: target.smtpPassword.value || undefined,
            smtp_from_email: target.smtpFromEmail.value || null,
            smtp_from_name: target.smtpFromName.value || null,
            smtp_use_tls: target.smtpUseTls.checked,
            sms_notifications_enabled: target.smsNotificationsEnabled.checked,
          })
        }}
        onChange={checkDirty}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Servidor SMTP</label>
            <input name="smtpHost" type="text" defaultValue={data.smtp_host ?? ''} className="input-field" placeholder="smtp.gmail.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Puerto</label>
            <input name="smtpPort" type="number" min={1} max={65535} defaultValue={data.smtp_port ?? 587} className="input-field font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Usuario</label>
            <input name="smtpUser" type="text" defaultValue={data.smtp_user ?? ''} className="input-field" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Contraseña {data.smtp_password_set && <span className="text-emerald-400 normal-case">(configurada)</span>}
            </label>
            <input name="smtpPassword" type="password" className="input-field" placeholder={data.smtp_password_set ? '••••••••' : ''} />
            <span className="text-[10px] text-muted-foreground block">Deje en blanco para mantener la contraseña actual.</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Correo remitente</label>
            <input name="smtpFromEmail" type="email" defaultValue={data.smtp_from_email ?? ''} className="input-field" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Nombre remitente</label>
            <input name="smtpFromName" type="text" defaultValue={data.smtp_from_name ?? ''} className="input-field" />
          </div>
        </div>

        <hr className="border-border/50" />

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
              <input name="smtpUseTls" type="checkbox" defaultChecked={data.smtp_use_tls} className="sr-only peer" />
              <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
            </label>
            <div>
              <span className="text-sm font-medium text-foreground block">Usar TLS</span>
              <span className="text-xs text-muted-foreground">Habilita conexión segura al servidor SMTP.</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
              <input name="smsNotificationsEnabled" type="checkbox" defaultChecked={data.sms_notifications_enabled} className="sr-only peer" />
              <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
            </label>
            <div>
              <span className="text-sm font-medium text-foreground block">Notificaciones por SMS</span>
              <span className="text-xs text-muted-foreground">Habilita el envío de SMS vía Twilio (configurado por el servidor).</span>
            </div>
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
  )
}


// ── Contenedor ────────────────────────────────────────────────────────────
export function Notifications({ isAdmin, setStatusMessage }: { isAdmin: boolean; setStatusMessage: StatusSetter }) {
  const [subTab] = useState<SubTab>('notificaciones')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSystemSettings,
    enabled: isAdmin && subTab === 'notificaciones',
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-settings'] })

  return (
    <div className="space-y-6 animate-fade-in">
      {subTab === 'notificaciones' && (
        isLoading || !data ? (
          <div className="glass-card p-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <NotificationSettingsForm data={data.notifications} onSaved={invalidate} setStatusMessage={setStatusMessage} />
        )
      )}
    </div>
  )
}
