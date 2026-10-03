/**
 * LoadBalancerPage — Gestión de balanceadores de carga (clonado de RouterPage).
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Shuffle, PlusCircle, Pencil, Trash2 } from 'lucide-react'
import api from '@/services/api'
import { LoadBalancerFormDialog } from '@/components/LoadBalancerFormDialog'
import { RouterStatusBadge } from '@/components/RouterStatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { formatUptime } from '@/lib/utils'

interface LoadBalancer {
  id: string
  name: string
  ip: string
  api_port: number
  api_username: string
  active: boolean
  hw_model: string | null
  notes: string | null
  latitude: number | null
  longitude: number | null
  site_id?: string | null
  site_name?: string | null
  zerotier_node_id?: string | null
  status?: 'online' | 'offline' | 'tunnel_down' | 'unknown' | null
  uptime?: string | null
  ros_version?: string | null
}

async function fetchLoadBalancers(): Promise<LoadBalancer[]> {
  const { data } = await api.get('/load-balancers')
  return data
}

async function deleteLoadBalancer(id: string): Promise<void> {
  await api.delete(`/load-balancers/${id}`)
}

export function LoadBalancerPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingLoadBalancer, setEditingLoadBalancer] = useState<LoadBalancer | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null)

  const { data: loadBalancers = [], isLoading } = useQuery({
    queryKey: ['load-balancers'],
    queryFn: fetchLoadBalancers,
    refetchInterval: 15_000,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteLoadBalancer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['load-balancers'] })
      setConfirmDelete(null)
      setDeleteErrorMessage(null)
    },
    onError: (err: unknown) => {
      const errorResponse = err as { response?: { data?: { detail?: string } } }
      setDeleteErrorMessage(errorResponse?.response?.data?.detail || 'Error al eliminar el balanceador.')
    },
  })

  const openAddDialog = () => {
    setEditingLoadBalancer(null)
    setDialogOpen(true)
  }

  const openEditDialog = (lb: LoadBalancer) => {
    setEditingLoadBalancer(lb)
    setDialogOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando balanceadores...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Shuffle className="w-6 h-6 text-amber-400" />
            Balanceadores de Carga
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              id="add-load-balancer"
              onClick={openAddDialog}
              className="w-full sm:w-auto bg-primary hover:bg-primary-hover text-primary-foreground font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              Agregar balanceador
            </button>
          )}
        </div>
      </div>

      {/* ── Tabla de balanceadores ── */}
      {loadBalancers.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Shuffle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin balanceadores registrados</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Agrega tu primer balanceador de carga MikroTik (RB o CCR) para comenzar.
          </p>
          {isAdmin && (
            <button onClick={openAddDialog} className="btn-primary mx-auto">
              <PlusCircle className="w-4 h-4" />
              Agregar primer balanceador
            </button>
          )}
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Balanceador</th>
                <th>Sitio</th>
                <th className="hidden md:table-cell">IP / Host</th>
                <th className="hidden lg:table-cell">Versión ROS</th>
                <th className="hidden lg:table-cell">Uptime</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {loadBalancers.map((lb) => (
                <tr
                  key={lb.id}
                  onClick={() => navigate(`/load-balancers/${lb.id}`)}
                  className="group cursor-pointer hover:bg-secondary/40 transition-colors"
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-amber-900/30 rounded-lg flex items-center justify-center border border-amber-800/40">
                        <Shuffle className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground text-sm">{lb.name}</p>
                        {lb.hw_model && (
                          <p className="text-xs text-muted-foreground">{lb.hw_model}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {lb.site_name ? (
                      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                        {lb.site_name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Sin Sitio</span>
                    )}
                  </td>
                  <td className="hidden md:table-cell">
                    <code className="text-xs bg-secondary/50 px-2 py-1 rounded text-muted-foreground font-mono">
                      {lb.ip}:{lb.api_port}
                    </code>
                  </td>
                  <td className="hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground font-mono">
                      {lb.ros_version ?? '—'}
                    </span>
                  </td>
                  <td className="hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {formatUptime(lb.uptime)}
                    </span>
                  </td>
                  <td>
                    <RouterStatusBadge status={lb.status ?? 'unknown'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Dialog crear/editar ── */}
      <LoadBalancerFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingLoadBalancer(null) }}
        loadBalancer={editingLoadBalancer}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['load-balancers'] })
          setDialogOpen(false)
          setEditingLoadBalancer(null)
        }}
        onDelete={(id) => setConfirmDelete(id)}
      />

      {/* ── Confirmación de eliminación ── */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar balanceador?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              El balanceador quedará desactivado y dejará de aparecer en el listado.
            </p>

            {deleteErrorMessage && (
              <div className="p-3 mb-4 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs animate-fade-in">
                {deleteErrorMessage}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDelete(null); setDeleteErrorMessage(null) }}
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
        </div>,
        document.body
      )}
    </div>
  )
}
