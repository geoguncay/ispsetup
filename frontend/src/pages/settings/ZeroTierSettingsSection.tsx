/**
 * ZeroTierSettingsSection — tarjeta de integración ZeroTier dentro de la
 * categoría "Integraciones" de Ajustes. Permite configurar el
 * Network ID / API Token de ZeroTier Central y ver el estado de la red y
 * sus miembros. Autorizar/revocar/renombrar nodos es deliberadamente de
 * solo lectura aquí — por decisión de seguridad, esa gestión se hace
 * exclusivamente desde my.zerotier.com (ver zerotier_api.py en el backend).
 */
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Network, Save, Loader2, RefreshCw, ShieldCheck, AlertTriangle, ExternalLink } from 'lucide-react'
import {
  getZeroTierSettings,
  updateZeroTierSettings,
  getZeroTierStatus,
  getZeroTierMembers,
  type ZeroTierSettingsRead,
} from '@/services/zerotier'
import { RouterStatusBadge } from '@/components/RouterStatusBadge'
import { saveButtonClass } from '@/lib/utils'
import { useFormDirty } from '@/hooks/useFormDirty'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

function errorDetail(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
}

function zeroTierCentralUrl(networkId: string | null): string {
  return networkId ? `https://my.zerotier.com/network/${networkId}` : 'https://my.zerotier.com'
}

function SettingsForm({
  data, onSaved, setStatusMessage,
}: { data: ZeroTierSettingsRead; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const { formRef, isDirty, snapshot, checkDirty } = useFormDirty()
  useEffect(() => { snapshot() }, [snapshot])

  const mutation = useMutation({
    mutationFn: updateZeroTierSettings,
    onSuccess: () => {
      onSaved()
      snapshot()
      setStatusMessage({ type: 'success', text: 'Configuración de ZeroTier guardada.' })
    },
    onError: (err: unknown) => {
      setStatusMessage({ type: 'error', text: errorDetail(err, 'Error al guardar la configuración de ZeroTier.') })
    },
  })

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault()
        const target = e.currentTarget as any
        mutation.mutate({
          zt_network_id: target.ztNetworkId.value || null,
          zt_api_token: target.ztApiToken.value || undefined,
          zt_enabled: target.ztEnabled.checked,
        })
      }}
      onChange={checkDirty}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Network ID</label>
          <input
            name="ztNetworkId" type="text" maxLength={32}
            defaultValue={data.zt_network_id ?? ''}
            className="input-field font-mono"
            placeholder="a1b2c3d4e5f6a7b8"
          />
          <span className="text-[10px] text-muted-foreground block">Se obtiene desde my.zerotier.com al crear la red.</span>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
            API Token {data.zt_api_token_set && <span className="text-emerald-400 normal-case">(configurado)</span>}
          </label>
          <input
            name="ztApiToken" type="password"
            className="input-field font-mono"
            placeholder={data.zt_api_token_set ? '••••••••' : ''}
          />
          <span className="text-[10px] text-muted-foreground block">Deje en blanco para mantener el token actual.</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
          <input name="ztEnabled" type="checkbox" defaultChecked={data.zt_enabled} className="sr-only peer" />
          <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
        </label>
        <div>
          <span className="text-sm font-medium text-foreground block">Integración activa</span>
          <span className="text-xs text-muted-foreground">Habilita la visibilidad de nodos ZeroTier desde esta pantalla.</span>
        </div>
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

function StatusSummary({ configured }: { configured: boolean }) {
  const { data: status, isLoading } = useQuery({
    queryKey: ['zerotier-status'],
    queryFn: getZeroTierStatus,
    enabled: configured,
    refetchInterval: 30_000,
  })

  if (!configured) return null
  if (isLoading || !status) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando conexión...</div>
  }

  if (!status.reachable) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5" />
        No se pudo conectar con ZeroTier Central{status.error ? `: ${status.error}` : '.'}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs text-emerald-400">
      <ShieldCheck className="w-3.5 h-3.5" />
      Conectado a la red {status.network_name ? `"${status.network_name}"` : status.network_id}
    </div>
  )
}

function MembersTable({ configured, networkId }: { configured: boolean; networkId: string | null }) {
  const queryClient = useQueryClient()

  const { data: members, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['zerotier-members'],
    queryFn: getZeroTierMembers,
    enabled: configured,
    retry: false,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['zerotier-members'] })

  if (!configured) return null

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Miembros de la red</h3>
          {/* hide text on small screens */}
          <p className="hidden sm:block text-muted-foreground text-xs mt-1">
            Autorizar, revocar o renombrar nodos se hace desde my.zerotier.com
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={zeroTierCentralUrl(networkId)}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:btn-secondary"
          >
            <ExternalLink className="w-4 h-4" />
            my.zerotier.com
          </a>
          <button type="button" onClick={invalidate} disabled={isFetching} className="btn-secondary">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Actualizar
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive justify-center py-8">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {errorDetail(error, 'No se pudo obtener la lista de miembros de ZeroTier.')}
        </div>
      ) : !members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Ningún equipo se ha unido todavía a esta red ZeroTier.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Nombre</th>
                <th>Node ID</th>
                <th>IP asignada</th>
                <th>Versión</th>
                <th>Autorizado</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.node_id}>
                  <td><RouterStatusBadge status={m.online ? 'online' : 'offline'} size="sm" /></td>
                  <td className="text-foreground">{m.name || <span className="text-muted-foreground italic">Sin nombre</span>}</td>
                  <td className="font-mono text-xs text-muted-foreground">{m.node_id}</td>
                  <td className="font-mono text-xs">{m.ip_assignments.join(', ') || '—'}</td>
                  <td className="text-xs text-muted-foreground">{m.version || '—'}</td>
                  <td>
                    {m.authorized ? (
                      <span className="text-xs font-medium text-emerald-400">Sí</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-400">Pendiente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function ZeroTierSettingsSection({ setStatusMessage }: { setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['zerotier-settings'],
    queryFn: getZeroTierSettings,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['zerotier-settings'] })
    queryClient.invalidateQueries({ queryKey: ['zerotier-status'] })
    queryClient.invalidateQueries({ queryKey: ['zerotier-members'] })
  }

  const configured = Boolean(data?.zt_network_id && data?.zt_api_token_set)

  return (
    <div className="space-y-6">
      <div className="glass-card p-6 space-y-6">
        <div className="flex flex-col items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Network className="w-5 h-5 text-brand-400" />
              ZeroTier
            </h3>
            <p className="hidden sm:block text-muted-foreground text-xs mt-1">
              Acceso remoto a los routers vía ZeroTier Central.
            </p>
          </div>
          {!isLoading && configured && <StatusSummary configured={configured} />}
        </div>

        {isLoading || !data ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SettingsForm data={data} onSaved={invalidate} setStatusMessage={setStatusMessage} />
        )}
      </div>

      <MembersTable configured={configured} networkId={data?.zt_network_id ?? null} />
    </div>
  )
}
