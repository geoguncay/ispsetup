/**
 * NmsRadiusSettingsSection — tarjeta "ISPSETUP / RADIUS" dentro de la categoría
 * "Integraciones" de Ajustes. Configura la IP alcanzable desde los Gateways
 * MikroTik que usan Traffic Flow y el servidor RADIUS de Accounting (ver
 * servicio `freeradius` en docker-compose.yml). El secreto RADIUS es propio
 * de cada Gateway y se configura en su diálogo de Ajustes ▸ Seguridad.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Radio, Save, Loader2 } from 'lucide-react'
import { getSystemSettings, updateNms, type NmsSettingsRead } from '@/services/systemSettings'
import { saveButtonClass } from '@/lib/utils'
import { useFormDirty } from '@/hooks/useFormDirty'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

function SettingsForm({
  data, onSaved, setStatusMessage,
}: { data: NmsSettingsRead; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const { formRef, isDirty, snapshot, checkDirty } = useFormDirty()
  useEffect(() => { snapshot() }, [snapshot])

  const mutation = useMutation({
    mutationFn: updateNms,
    onSuccess: () => {
      onSaved()
      snapshot()
      setStatusMessage({ type: 'success', text: 'Configuración de ISPSETUP/RADIUS guardada.' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar la configuración de ISPSETUP/RADIUS.' })
    },
  })

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        const target = e.currentTarget as any
        mutation.mutate({ ispsetup_server_ip: target.ispsetupServerIp.value || null })
      }}
      onChange={checkDirty}
      className="space-y-6"
    >
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
          IP del servidor ISPSETUP
        </label>
        <input
          name="ispsetupServerIp" type="text" maxLength={255}
          defaultValue={data.ispsetup_server_ip ?? ''}
          className="input-field font-mono"
          placeholder="10.0.0.10"
        />
        <span className="text-[10px] text-muted-foreground block">
          Dirección alcanzable desde todos los Gateways (LAN, VPN o ZeroTier). La usan Traffic Flow
          y el servidor RADIUS de Accounting.
        </span>
      </div>

      <div className="flex justify-end pt-4 border-t border-border/50">
        <button type="submit" disabled={mutation.isPending} className={saveButtonClass(isDirty, mutation.isPending)}>
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {mutation.isPending ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

export function NmsRadiusSettingsSection({ setStatusMessage }: { setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSystemSettings,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-settings'] })

  return (
    <div className="glass-card p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Radio className="w-5 h-5 text-brand-400" />
          SERVER / RADIUS
        </h3>
        <p className="text-muted-foreground text-xs mt-1">
          IP del servidor local que reciben los Gateways para Traffic Flow y Accounting RADIUS. El
          secreto RADIUS de cada Gateway se configura en su propio diálogo de Ajustes ▸ Seguridad.
        </p>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <SettingsForm data={data.ispsetup} onSaved={invalidate} setStatusMessage={setStatusMessage} />
      )}
    </div>
  )
}
