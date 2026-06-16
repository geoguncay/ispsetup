/**
 * RoutersPage — Gestión de routers MikroTik con estado en tiempo real.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Wifi, Server, Clock, ChevronRight, Trash2, Edit2 } from 'lucide-react'
import api from '@/services/api'
import { RouterStatusBadge } from '@/components/RouterStatusBadge'
import { RouterFormDialog } from '@/components/RouterFormDialog'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'

interface Router {
  id: string
  nombre: string
  ip: string
  puerto_api: number
  usuario_api: string
  activo: boolean
  modelo_hw: string | null
  notas: string | null
  status: 'online' | 'offline' | 'degraded' | 'unknown' | null
  uptime: string | null
  ros_version: string | null
}

async function fetchRouters(): Promise<Router[]> {
  const { data } = await api.get('/routers')
  return data
}

async function deleteRouter(id: string): Promise<void> {
  await api.delete(`/routers/${id}`)
}

export function RoutersPage() {
  const { user } = useAuthStore()
  const { hideIps } = useSettingsStore()
  const queryClient = useQueryClient()
  const isAdmin = user?.rol === 'admin'

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRouter, setEditingRouter] = useState<Router | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const { data: routers = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['routers'],
    queryFn: fetchRouters,
    refetchInterval: 30_000, // polling cada 30 s
  })

  const deleteMutation = useMutation({
    mutationFn: deleteRouter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routers'] })
      setConfirmDelete(null)
    },
  })

  const onlineCount = routers.filter((r) => r.status === 'online').length
  const offlineCount = routers.filter((r) => r.status === 'offline').length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando routers...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Routers</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Gestión de routers MikroTik remotos o locales (VPN, ZeroTier, LAN, etc.)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="refresh-routers"
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          {isAdmin && (
            <button
              id="add-router"
              onClick={() => { setEditingRouter(null); setDialogOpen(true) }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Agregar router
            </button>
          )}
        </div>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: routers.length, icon: Server, color: 'text-brand-400' },
          { label: 'En línea', value: onlineCount, icon: Wifi, color: 'text-emerald-400' },
          { label: 'Fuera de línea', value: offlineCount, icon: Wifi, color: 'text-red-400' },
          { label: 'Desconocido', value: routers.length - onlineCount - offlineCount, icon: Clock, color: 'text-slate-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Tabla de routers ── */}
      {routers.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin routers registrados</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Agrega tu primer router MikroTik para comenzar a gestionar tu red.
          </p>
          {isAdmin && (
            <button onClick={() => setDialogOpen(true)} className="btn-primary mx-auto">
              <Plus className="w-4 h-4" />
              Agregar primer router
            </button>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Router</th>
                <th className="hidden md:table-cell">IP / Host</th>
                <th>Estado</th>
                <th className="hidden lg:table-cell">Versión ROS</th>
                <th className="hidden lg:table-cell">Uptime</th>
                {isAdmin && <th className="text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {routers.map((router) => (
                <tr key={router.id} className="group">
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-brand-900/50 rounded-lg flex items-center justify-center border border-brand-800/50">
                        <Server className="w-4 h-4 text-brand-400" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground text-sm">{router.nombre}</p>
                        {router.modelo_hw && (
                          <p className="text-xs text-muted-foreground">{router.modelo_hw}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell">
                    <code className="text-xs bg-secondary/50 px-2 py-1 rounded text-muted-foreground font-mono">
                      {hideIps ? '••••••••' : router.ip}:{router.puerto_api}
                    </code>
                  </td>
                  <td>
                    <RouterStatusBadge status={router.status ?? 'unknown'} />
                  </td>
                  <td className="hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground font-mono">
                      {router.ros_version ?? '—'}
                    </span>
                  </td>
                  <td className="hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {router.uptime ?? '—'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          id={`edit-router-${router.id}`}
                          onClick={() => { setEditingRouter(router); setDialogOpen(true) }}
                          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          id={`delete-router-${router.id}`}
                          onClick={() => setConfirmDelete(router.id)}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Confirmación de borrado ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar router?</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Esta acción desactivará el router. No se eliminan datos históricos.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                id="confirm-delete-router"
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

      {/* ── Dialog crear/editar ── */}
      <RouterFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        router={editingRouter}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['routers'] })
          setDialogOpen(false)
        }}
      />
    </div>
  )
}
