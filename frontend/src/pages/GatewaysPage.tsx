/**
 * GatewaysPage — Gestión de gateways MikroTik con estado en tiempo real.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Wifi, Server, Clock, Download, X, Loader2, SlidersHorizontal } from 'lucide-react'
import api from '@/services/api'
import { GatewayStatusBadge } from '@/components/GatewayStatusBadge'
import { GatewayFormDialog } from '@/components/GatewayFormDialog'
import { GatewayDeleteDialog, type GatewayDeletionOptions } from '@/components/GatewayDeleteDialog'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { formatUptime } from '@/lib/utils'

interface Gateway {
  id: string
  name: string
  ip: string
  api_port: number
  api_username: string
  active: boolean
  hw_model: string | null
  notes: string | null
  status: 'online' | 'offline' | 'degraded' | 'unknown' | null
  uptime: string | null
  ros_version: string | null
  traffic_monitoring: boolean
  speed_control: boolean
  sync_logs: boolean
  alert_notifications: boolean
  site_id?: string | null
  site_name?: string | null
}

async function fetchGateways(): Promise<Gateway[]> {
  const { data } = await api.get('/gateways')
  return data
}

async function deleteGateway({ id, options }: { id: string; options: GatewayDeletionOptions }): Promise<void> {
  await api.delete(`/gateways/${id}`, {
    params: {
      cleanup_routeros: options.cleanupRouterOs,
      delete_historical_data: options.deleteHistoricalData,
      confirmation: options.confirmation,
    },
  })
}

export function GatewaysPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGateway, setEditingGateway] = useState<Gateway | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Address-list client import states
  const [importingGateway, setImportingGateway] = useState<Gateway | null>(null)
  const [selectedListName, setSelectedListName] = useState('clientes')
  const [customListName, setCustomListName] = useState('')

  // Query to get address list names from the selected gateway
  const { data: addressLists = [], isLoading: isLoadingLists } = useQuery<string[]>({
    queryKey: ['address-lists', importingGateway?.id],
    queryFn: async () => {
      const { data } = await api.get(`/gateways/${importingGateway?.id}/address-lists`)
      return data
    },
    enabled: !!importingGateway,
  })

  const { data: gateways = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['gateways'],
    queryFn: fetchGateways,
    refetchInterval: 15_000, // polling cada 15 s
  })

  const deleteMutation = useMutation({
    mutationFn: deleteGateway,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateways'] })
      setConfirmDelete(null)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (payload: { gatewayId: string; listName: string }) => {
      const { data } = await api.post(`/gateways/${payload.gatewayId}/import-clients`, null, {
        params: { list_name: payload.listName }
      })
      return data as { imported_count: number }
    },
    onSuccess: (data) => {
      alert(`Importación exitosa. Se importaron ${data.imported_count} nuevos clientes.`)
      setImportingGateway(null)
      queryClient.invalidateQueries({ queryKey: ['gateways'] })
    },
    onError: (err: unknown) => {
      const errorResponse = err as { response?: { data?: { detail?: string } } }
      const msg = errorResponse?.response?.data?.detail || 'Error al importar clientes desde el gateway.'
      alert(msg)
      setImportingGateway(null)
    }
  })

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!importingGateway) return
    const listName = selectedListName === 'custom' ? customListName.trim() : selectedListName
    if (!listName) return
    importMutation.mutate({ gatewayId: importingGateway.id, listName })
  }

  const [selectedSiteId, setSelectedSiteId] = useState('')

  // Consultar lista de Sitios para el filtro
  const { data: sites = [] } = useQuery<any[]>({
    queryKey: ['sites-list'],
    queryFn: async () => {
      const { data } = await api.get('/sites')
      return data
    },
  })

  const filteredGateways = gateways.filter((gateway) => {
    if (selectedSiteId === '') return true
    return gateway.site_id === selectedSiteId
  })

  const onlineCount = filteredGateways.filter((gateway) => gateway.status === 'online').length
  const offlineCount = filteredGateways.filter((gateway) => gateway.status === 'offline').length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando gateways...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gateways</h1>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              id="add-gateway"
              onClick={() => { setEditingGateway(null); setDialogOpen(true) }}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              Agregar gateway
            </button>
          )}
        </div>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: filteredGateways.length, icon: Server, color: 'text-brand-400' },
          { label: 'En línea', value: onlineCount, icon: Wifi, color: 'text-emerald-400' },
          { label: 'Fuera de línea', value: offlineCount, icon: Wifi, color: 'text-red-400' },
          { label: 'Desconocido', value: filteredGateways.length - onlineCount - offlineCount, icon: Clock, color: 'text-slate-400' },
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

      {/* ── Tabla de gateways ── */}
      {gateways.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin gateways registrados</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Agrega tu primer gateway MikroTik para comenzar a gestionar tu red.
          </p>
          {isAdmin && (
            <button onClick={() => setDialogOpen(true)} className="btn-primary mx-auto">
              <Plus className="w-4 h-4" />
              Agregar primer gateway
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">

          {filteredGateways.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Sin gateways en este sitio</h3>
              <p className="text-muted-foreground text-sm">
                No hay ningún gateway MikroTik asociado al sitio seleccionado.
              </p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Gateway</th>
                    <th>Sitio</th>
                    <th className="hidden md:table-cell">IP / Host</th>
                    <th className="hidden lg:table-cell">Versión ROS</th>
                    <th className="hidden lg:table-cell">Uptime</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGateways.map((gateway) => (
                    <tr
                      key={gateway.id}
                      onClick={() => navigate(`/gateways/${gateway.id}`)}
                      className="group cursor-pointer hover:bg-secondary/40 transition-colors"
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-brand-900/50 rounded-lg flex items-center justify-center border border-brand-800/50">
                            <Server className="w-4 h-4 text-brand-400" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground text-sm">{gateway.name}</p>
                            {gateway.hw_model && (
                              <p className="text-xs text-muted-foreground">{gateway.hw_model}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {gateway.site_name ? (
                          <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                            {gateway.site_name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Sin Sitio</span>
                        )}
                      </td>
                      <td className="hidden md:table-cell">
                        <code className="text-xs bg-secondary/50 px-2 py-1 rounded text-muted-foreground font-mono">
                          {gateway.ip}:{gateway.api_port}
                        </code>
                      </td>
                      <td className="hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground font-mono">
                          {gateway.ros_version ?? '—'}
                        </span>
                      </td>
                      <td className="hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {formatUptime(gateway.uptime)}
                        </span>
                      </td>
                      <td>
                        <GatewayStatusBadge status={gateway.status ?? 'unknown'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <GatewayDeleteDialog
        open={Boolean(confirmDelete)}
        gatewayName={gateways.find((gateway) => gateway.id === confirmDelete)?.name ?? 'Gateway'}
        pending={deleteMutation.isPending}
        error={(deleteMutation.error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail}
        onClose={() => setConfirmDelete(null)}
        onConfirm={(options) => {
          if (confirmDelete) deleteMutation.mutate({ id: confirmDelete, options })
        }}
      />

      {/* ── Dialog crear/editar ── */}
      <GatewayFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingGateway(null) }}
        gateway={editingGateway}
        onSuccess={(savedGateway) => {
          queryClient.invalidateQueries({ queryKey: ['gateways'] })
          setDialogOpen(false)
          const wasEditing = Boolean(editingGateway)
          setEditingGateway(null)
          if (!wasEditing) {
            navigate(`/gateways/${savedGateway.id}`)
          }
        }}
        onDelete={(id) => setConfirmDelete(id)}
      />

      {/* Modal Importar Clientes de Address-list */}
      {importingGateway && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md mx-4 animate-fade-in border border-border/50">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Download className="w-5 h-5 text-brand-400" />
                Importar desde Address-list
              </h2>
              <button
                type="button"
                onClick={() => setImportingGateway(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="p-5 space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Selecciona una lista de direcciones del gateway <strong>{importingGateway.name}</strong>. Se importarán todas sus IPs y se registrarán como nuevos clientes en el sistema y en la lista <strong>clientes</strong> de MikroTik.
              </p>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Seleccionar Address-list *
                </label>
                {isLoadingLists ? (
                  <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando listas del gateway...
                  </div>
                ) : (
                  <select
                    value={selectedListName}
                    onChange={(e) => {
                      setSelectedListName(e.target.value)
                      if (e.target.value !== 'custom') {
                        setCustomListName('')
                      }
                    }}
                    className="input-field cursor-pointer"
                  >
                    <option value="clientes">clientes (Por defecto)</option>
                    {addressLists
                      .filter((l: string) => l !== 'clientes')
                      .map((listName: string) => (
                        <option key={listName} value={listName}>
                          {listName}
                        </option>
                      ))}
                    <option value="custom">-- Escribir name personalizado --</option>
                  </select>
                )}
              </div>

              {selectedListName === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Nombre de la lista personalizado *
                  </label>
                  <input
                    type="text"
                    value={customListName}
                    onChange={(e) => setCustomListName(e.target.value)}
                    placeholder="Ej: IPs_Nuevas, WAN_List, etc."
                    required
                    className="input-field font-sans"
                  />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setImportingGateway(null)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={importMutation.isPending || (selectedListName === 'custom' && !customListName.trim())}
                  className="btn-primary flex-1 justify-center"
                >
                  {importMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {importMutation.isPending ? 'Importando...' : 'Importar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
