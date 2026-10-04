// -- Active: 1782457342014@@127.0.0.1@5432@isp_platform
/**
 * ClientsPage — Gestión de clientes del ISP con filtros dinámicos y paginación.
 */
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { ToastContainer } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { RefreshCw, Search, Users, Wifi, UserCheck, UserX, SlidersHorizontal, ArrowUpDown, ChevronUp, ChevronDown,
  Upload, Clock, RotateCcw, PlusCircle
} from 'lucide-react'
import api from '@/services/api'
import { ClientFormDialog } from '@/components/ClientFormDialog'
import { ClientImportDialog } from '@/components/ClientImportDialog'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import { formatDate, formatDateTime } from '@/lib/utils'

interface Client {
  id: string
  full_name: string
  last_name: string | null
  first_name: string | null
  cedula: string
  phone: string
  address: string
  latitude: number | null
  longitude: number | null
  router_id: string
  access_method: 'static' | 'pppoe'
  medium?: 'radio' | 'fiber' | 'unspecified'
  active: boolean
  scheduled_suspension?: string | null
  scheduled_reactivation?: string | null
  plan_activo: { id: string; name: string; speed_down_mbps: number; speed_up_mbps: number; price: number } | null
  router_name: string | null
  static_ip?: { ip: string } | null
  email?: string | null
  created_at: string
  site_id?: string | null
  site_name?: string | null
}

interface RouterOption {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
}

interface Plan {
  id: string
  name: string
}

export function ClientsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { toasts, addToast, removeToast } = useToast()
  const toastShown = useRef(false)
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  // Mostrar toast si venimos de una acción (ej: eliminar cliente)
  useEffect(() => {
    if (toastShown.current) return
    const state = location.state as { toast?: { message: string; type: 'success' | 'error' | 'warning' } } | null
    if (state?.toast) {
      toastShown.current = true
      addToast(state.toast.message, state.toast.type)
      window.history.replaceState({}, '')
    }
  }, [location.state, addToast])

  // State de filtros y paginación
  const [search, setSearch] = useState('')
  const [routerId, setRouterId] = useState('')
  const [planId, setPlanId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [active, setActive] = useState('')
  const [accessMethod, setAccessMethod] = useState('')
  const [medium, setMedium] = useState('')
  const [page, setPage] = useState(1)
  const limit = 10

  // Estados para ordenamiento
  const [sortField, setSortField] = useState<string>('last_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Modales
  const [formOpen, setFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Consultar Routers, Planes y Sitios para los dropdowns
  const { data: routers = [] } = useQuery<RouterOption[]>({
    queryKey: ['routers-list-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/routers')
      return data
    }
  })

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['plans-list-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/plans')
      return data
    }
  })

  const { data: sites = [] } = useQuery<any[]>({
    queryKey: ['sites-list-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/sites')
      return data
    }
  })

  // Consultar Clientes
  const { data: clientsData = { items: [], total: 0 }, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['clients', page, search, routerId, planId, siteId, active, accessMethod, medium, sortField, sortDir],
    queryFn: async () => {
      const params: any = {
        skip: (page - 1) * limit,
        limit: limit,
        sort_by: sortField,
        sort_dir: sortDir,
      }
      if (search.trim()) params.search = search
      if (routerId) params.router_id = routerId
      if (planId) params.plan_id = planId
      if (siteId) params.site_id = siteId
      if (active) params.active = active === 'true'
      if (accessMethod) params.access_method = accessMethod
      if (medium) params.medium = medium

      const { data } = await api.get('/clients', { params })
      return data
    },
    placeholderData: (previousData) => previousData,
    // Refresca solo para reflejar suspensiones/reactivaciones aplicadas por el worker en segundo plano.
    refetchInterval: 30_000,
  })

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleEdit = (client: Client) => {
    setEditingClient(client)
    setFormOpen(true)
  }

  const handleCreate = () => {
    setEditingClient(null)
    setFormOpen(true)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
  }

  const totalPages = Math.ceil(clientsData.total / limit)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-cyan-400 animate-pulse" />
            Clientes
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setImportOpen(true)}
            className="bg-secondary hidden sm:flex items-center hover:bg-secondary-hover text-secondary-foreground font-semibold px-4 py-2.5 rounded-lg justify-center gap-1 transition-all shadow-lg shadow-secondary/20 cursor-pointer"

          >
            <Upload className="w-4 h-4" />
            Importar
          </button>
          <button
            onClick={handleCreate}
            className="w-full sm:w-auto bg-primary hover:bg-primary-hover text-primary-foreground font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            Nuevo cliente
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-brand-400 tracking-wider uppercase mb-1">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filtros de búsqueda
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Búsqueda */}
          <div className="relative col-span-1 sm:col-span-2 md:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar name o cédula..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="input-field pl-9"
            />
          </div>
          <div className="hidden sm:grid  md:grid-cols-6 gap-3">
          {/* Router */}
          <select
            value={routerId}
            onChange={(e) => { setRouterId(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Todos los routers</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          {/* Sitio */}
          <select
            id="filter-client-site"
            value={siteId}
            onChange={(e) => { setSiteId(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Todos los sitios</option>
            {sites.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Plan */}
          <select
            value={planId}
            onChange={(e) => { setPlanId(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Todos los planes</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Estado */}
          <select
            value={active}
            onChange={(e) => { setActive(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Cualquier estado</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos / Suspendidos</option>
          </select>

          {/* Medio físico */}
          <select
            value={medium}
            onChange={(e) => { setMedium(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Cualquier medio</option>
            <option value="radio">Radioenlace</option>
            <option value="fiber">Fibra óptica</option>
            <option value="unspecified">Sin especificar</option>
          </select>

          {/* Método de asignación de IP */}
          <select
            value={accessMethod}
            onChange={(e) => { setAccessMethod(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Cualquier método</option>
            <option value="static">IP Estática</option>
            <option value="pppoe">PPPoE</option>
          </select>
          </div>
        </div>
      </div>

      {/* Listado de Clientes */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Cargando clientes...</span>
          </div>
        </div>
      ) : clientsData.items.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No se encontraron clientes</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Intenta cambiar los filtros o registra un nuevo cliente en el sistema.
          </p>
          <button onClick={handleCreate} className="btn-primary mx-auto">
            <PlusCircle className="w-4 h-4" />
            Nuevo cliente
          </button>
        </div>
      ) : (
        <div className="space-y-4">
            <>
              <div className="glass-card overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('last_name')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Apellidos</span>
                          {sortField === 'last_name' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('first_name')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Nombres</span>
                          {sortField === 'first_name' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('cedula')} className="hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Cédula</span>
                          {sortField === 'cedula' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('email')} className=" hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Correo Electrónico</span>
                          {sortField === 'email' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('created_at')} className="hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Fecha Reg.</span>
                          {sortField === 'created_at' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('ip')} className="hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>IP</span>
                          {sortField === 'ip' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('medium')} className="hidden lg:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Medio</span>
                          {sortField === 'medium' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th className="hidden lg:table-cell">
                        Sitio
                      </th>
                      <th onClick={() => handleSort('router')} className="hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Router</span>
                          {sortField === 'router' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('plan')} className="hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Plan Activo</span>
                          {sortField === 'plan' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('active')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Estado</span>
                          {sortField === 'active' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientsData.items.map((client: Client) => (
                      <tr
                        key={client.id}
                        onClick={() => navigate(`/clients/${client.id}`)}
                        className="group cursor-pointer hover:bg-secondary/40 transition-colors"
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-brand-900/30 rounded-lg flex items-center justify-center border border-brand-800/50 shrink-0">
                              <Users className="w-4 h-4 text-brand-400" />
                            </div>
                            <span className="font-semibold text-foreground text-sm">
                              {client.last_name || client.full_name}
                            </span>
                          </div>
                        </td>
                        <td className="sm:table-cell font-semibold text-foreground text-sm">
                          {client.first_name || <span className="italic opacity-40">—</span>}
                        </td>
                        <td className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                          {client.cedula}
                        </td>
                        <td className="hidden sm:table-cell text-xs text-muted-foreground font-medium">
                          {client.email || <span className="italic opacity-50">—</span>}
                        </td>
                        <td className="hidden sm:table-cell text-xs text-muted-foreground font-medium">
                          {formatDate(client.created_at, dateFormat)}
                        </td>
                        <td className="hidden sm:table-cell font-mono text-xs text-foreground font-semibold">
                          {client.static_ip?.ip ? (
                            client.static_ip.ip
                          ) : (
                            <span className="text-muted-foreground font-normal italic">—</span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell">
                          {client.medium === 'radio' ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Radio</span>
                          ) : client.medium === 'fiber' ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Fibra</span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">—</span>
                          )}
                        </td>
                        <td className="hidden sm:table-cell">
                          {client.site_name ? (
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                              {client.site_name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin Sitio</span>
                          )}
                        </td>
                        <td className="hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground font-medium">
                            {client.router_name ?? '—'}
                          </span>
                        </td>
                        <td className="hidden sm:table-cell">
                          {client.plan_activo ? (
                            <div className="flex items-center gap-1.5">
                              <Wifi className="w-3.5 h-3.5 text-brand-400" />
                              <span className="text-xs text-brand-300 font-medium">{client.plan_activo.name}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin plan</span>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            let status: 'active' | 'scheduled_suspension' | 'scheduled_reactivation' | 'suspended' = 'active';
                            if (client.active) {
                              if (client.scheduled_suspension) status = 'scheduled_suspension';
                            } else {
                              status = client.scheduled_reactivation ? 'scheduled_reactivation' : 'suspended';
                            }

                            if (status === 'active') {
                              return (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  <UserCheck className="w-3.5 h-3.5" /> Activo
                                </span>
                              )
                            } else if (status === 'scheduled_suspension') {
                              return (
                                <span
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20"
                                  title={`Suspensión programada: ${formatDateTime(client.scheduled_suspension, dateFormat, timeFormat)}`}
                                >
                                  <Clock className="w-3.5 h-3.5" /> Aplazado
                                </span>
                              )
                            } else if (status === 'scheduled_reactivation') {
                              return (
                                <span
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                  title={`Reactivación programada: ${formatDateTime(client.scheduled_reactivation, dateFormat, timeFormat)}`}
                                >
                                  <RotateCcw className="w-3.5 h-3.5" /> Reactivación programada
                                </span>
                              )
                            } else {
                              return (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  <UserX className="w-3.5 h-3.5" /> Suspendido
                                </span>
                              )
                            }
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-1">
                  <span className="text-xs text-muted-foreground">
                    Mostrando {clientsData.items.length} de {clientsData.total} clientes
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page === 1}
                      className="btn-secondary py-1.5 px-3 text-xs"
                    >
                      Anterior
                    </button>
                    <span className="text-xs text-foreground font-medium font-mono px-2">
                      Página {page} de {totalPages}
                    </span>
                    <button
                      onClick={() => handlePageChange(page + 1)}
                      disabled={page === totalPages}
                      className="btn-secondary py-1.5 px-3 text-xs"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </>
        </div>
      )}

      {/* Dialog para Crear/Editar Cliente */}
      <ClientFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        client={editingClient}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['clients'] })
          setFormOpen(false)
          setEditingClient(null)
        }}
      />

      {/* Dialog para Importación de Clientes */}
      <ClientImportDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['clients'] })
        }}
      />

      {/* Notificaciones toast */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}
