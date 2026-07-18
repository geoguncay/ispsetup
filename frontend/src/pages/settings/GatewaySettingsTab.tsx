import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SlidersHorizontal, Clock, Save, Loader2, MapPin, Plus, Edit2, Trash2,
} from 'lucide-react'
import api from '@/services/api'
import { SiteFormModal, type SiteItem } from '@/components/SiteFormModal'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

export function GatewaySettingsTab({ isAdmin, setStatusMessage }: { isAdmin: boolean; setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  // ── MikroTik API ─────────────────────────────────────────────────────────
  const [mikrotikAttempts, setMikrotikAttempts] = useState(1)
  const [mikrotikTimeout, setMikrotikTimeout] = useState(10)
  const [mikrotikDebug, setMikrotikDebug] = useState(false)
  const [mikrotikSsl, setMikrotikSsl] = useState(false)

  const { data: mikrotikConfig } = useQuery({
    queryKey: ['mikrotik-api-config'],
    queryFn: async () => {
      const { data } = await api.get('/settings/mikrotik-api')
      return data
    },
    enabled: isAdmin,
  })

  useEffect(() => {
    if (mikrotikConfig) {
      setMikrotikAttempts(mikrotikConfig.mikrotik_attempts)
      setMikrotikTimeout(mikrotikConfig.mikrotik_timeout)
      setMikrotikDebug(mikrotikConfig.mikrotik_debug)
      setMikrotikSsl(mikrotikConfig.mikrotik_ssl)
    }
  }, [mikrotikConfig])

  const mikrotikDirty = !!mikrotikConfig && (
    mikrotikAttempts !== mikrotikConfig.mikrotik_attempts ||
    mikrotikTimeout !== mikrotikConfig.mikrotik_timeout ||
    mikrotikDebug !== mikrotikConfig.mikrotik_debug ||
    mikrotikSsl !== mikrotikConfig.mikrotik_ssl
  )

  const mikrotikApiMutation = useMutation({
    mutationFn: async (payload: object) => {
      const { data } = await api.put('/settings/mikrotik-api', payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mikrotik-api-config'] })
      setStatusMessage({ type: 'success', text: 'Configuración de MikroTik API guardada.' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar configuración.' })
    },
  })

  const handleSaveMikrotikApi = () => {
    mikrotikApiMutation.mutate({
      mikrotik_timeout: mikrotikTimeout,
      mikrotik_attempts: mikrotikAttempts,
      mikrotik_debug: mikrotikDebug,
      mikrotik_ssl: mikrotikSsl,
    })
  }

  // ── Sitios ───────────────────────────────────────────────────────────────
  const [confirmDeleteSite, setConfirmDeleteSite] = useState<{ id: string; name: string } | null>(null)
  const [siteModalOpen, setSiteModalOpen] = useState(false)
  const [siteModalSite, setSiteModalSite] = useState<SiteItem | null>(null)

  const { data: sitesList = [], isLoading: loadingSites } = useQuery<SiteItem[]>({
    queryKey: ['sites-list'],
    queryFn: async () => { const { data } = await api.get('/sites'); return data },
  })

  const deleteSiteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/sites/${id}`) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites-list'] }),
  })

  return (
    <div className="space-y-4">

      {/* ── Sección: MikroTik API ──────────────────────────────────────── */}
      <div className="glass-card p-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-brand-400" />
            MikroTik API
          </h3>
          <p className="text-muted-foreground text-xs mt-1">
            Parámetros globales de conexión a la API de MikroTik aplicados a todos los gateways.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Attempts */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Attempts
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={mikrotikAttempts}
              onChange={(e) => setMikrotikAttempts(Math.max(1, parseInt(e.target.value) || 1))}
              className="input-field font-mono max-w-[160px]"
            />
            <p className="text-[11px] text-muted-foreground">Intentos de reconexión antes de marcar el gateway como offline.</p>
          </div>

          {/* Timeout */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Timeout (seg)
            </label>
            <input
              type="number"
              min={1}
              max={120}
              value={mikrotikTimeout}
              onChange={(e) => setMikrotikTimeout(Math.max(1, parseInt(e.target.value) || 1))}
              className="input-field font-mono max-w-[160px]"
            />
            <p className="text-[11px] text-muted-foreground">Segundos de espera máxima por respuesta de la API.</p>
          </div>

          {/* Debug */}
          <div className="flex items-center gap-4 py-3 px-4 rounded-xl bg-secondary/20 border border-border/50">
            <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
              <input type="checkbox" checked={mikrotikDebug} onChange={(e) => setMikrotikDebug(e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
            </label>
            <div>
              <span className="text-sm font-medium text-foreground block">Debug / Logs RouterOS</span>
              <span className="text-xs text-muted-foreground">Registra el tráfico detallado de la API.</span>
            </div>
          </div>

          {/* SSL */}
          <div className="flex items-center gap-4 py-3 px-4 rounded-xl bg-secondary/20 border border-border/50">
            <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
              <input type="checkbox" checked={mikrotikSsl} onChange={(e) => setMikrotikSsl(e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
            </label>
            <div>
              <span className="text-sm font-medium text-foreground block">SSL</span>
              <span className="text-xs text-muted-foreground">Usar conexión cifrada TLS/SSL con la API de MikroTik.</span>
            </div>
          </div>
        </div>

        {/* Nota dinámica: tiempo máximo para marcar offline */}
        {(() => {
          const worstCase = mikrotikAttempts * mikrotikTimeout + Math.max(0, mikrotikAttempts - 1)
          const waitBetween = Math.max(0, mikrotikAttempts - 1)
          return (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 leading-relaxed">
              <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                Con los valores actuales, un gateway sin respuesta tardará hasta{' '}
                <strong className="text-amber-200">{worstCase} seg</strong> en ser marcado como{' '}
                <span className="font-semibold">offline</span>
                {' '}({mikrotikAttempts} intento{mikrotikAttempts !== 1 ? 's' : ''} × {mikrotikTimeout}s
                {waitBetween > 0 ? ` + ${waitBetween}s de espera entre intentos` : ''}).
                {worstCase > 60 && (
                  <span className="block mt-1 text-amber-400/80">
                    ⚠ Esto supera el intervalo del health check (60s) — algunos ciclos podrían saltarse gateways lentos.
                  </span>
                )}
              </span>
            </div>
          )
        })()}

        <div className="flex justify-end pt-2 border-t border-border/50">
          <button
            type="button"
            onClick={handleSaveMikrotikApi}
            disabled={mikrotikApiMutation.isPending}
            className={`${mikrotikDirty || mikrotikApiMutation.isPending ? 'btn-primary' : 'btn-secondary'} px-5 disabled:opacity-50`}
          >
            {mikrotikApiMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Save className="w-4 h-4" />}
            {mikrotikApiMutation.isPending ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* ── Sección: Sitios ───────────────────────────────────────────── */}
      <div className="glass-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <MapPin className="w-5 h-5 text-brand-400" />
              Sitios
            </h3>
            <p className="text-muted-foreground text-xs mt-1">
              Sitios disponibles para gateways y zona de clientes. Cada sitio puede tener coordenadas GPS.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setSiteModalSite(null); setSiteModalOpen(true) }}
            className="btn-primary shrink-0"
          >
            <Plus className="w-4 h-4" />
            Agregar sitio
          </button>
        </div>

        {/* Tabla de sitios */}
        {loadingSites ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando sitios...
          </div>
        ) : sitesList.length > 0 ? (
          <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/40 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Latitud</th>
                  <th className="px-4 py-3">Longitud</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-sm">
                {sitesList.map((site) => (
                  <tr key={site.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-foreground">{site.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-muted-foreground text-xs">
                        {site.latitude != null ? site.latitude.toFixed(6) : <span className="opacity-40">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-muted-foreground text-xs">
                        {site.longitude != null ? site.longitude.toFixed(6) : <span className="opacity-40">—</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setSiteModalSite(site); setSiteModalOpen(true) }}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSite({ id: site.id, name: site.name })}
                          className="p-1 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No hay sitios creados</p>
            <p className="text-xs mt-1">Haz clic en "Agregar sitio" para comenzar.</p>
          </div>
        )}
      </div>

      {/* ── Modal: Crear / Editar Sitio ───────────────────────────────────── */}
      <SiteFormModal
        open={siteModalOpen}
        onClose={() => setSiteModalOpen(false)}
        site={siteModalSite}
      />

      {/* ── Modal: Confirmar eliminación de sitio ─────────────────────────── */}
      {confirmDeleteSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-destructive/10 text-destructive rounded-lg shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">¿Eliminar sitio?</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Vas a eliminar el sitio <span className="font-semibold text-foreground">"{confirmDeleteSite.name}"</span>.
                  Los gateways asignados a este sitio quedarán sin sitio asignado.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteSite(null)}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteSiteMutation.isPending}
                onClick={() => {
                  deleteSiteMutation.mutate(confirmDeleteSite.id, {
                    onSuccess: () => setConfirmDeleteSite(null),
                  })
                }}
                className="btn-destructive flex-1 justify-center"
              >
                {deleteSiteMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Eliminando...</>
                ) : (
                  <><Trash2 className="w-4 h-4" /> Eliminar</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
