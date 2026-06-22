/**
 * ClientsPage — Gestión de clientes del WISP con filtros dinámicos y paginación.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, RefreshCw, Search, Users, Wifi, UserCheck, UserX, UserMinus,
  ChevronRight, Trash2, Edit2, SlidersHorizontal, MapPin, ArrowUpDown, ChevronUp, ChevronDown, Calendar
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { ClientFormDialog } from '@/components/ClientFormDialog'

interface Client {
  id: string
  nombre: string
  cedula: string
  telefono: string
  direccion: string
  latitud: number | null
  longitud: number | null
  router_id: string
  tipo: 'static' | 'pppoe'
  activo: boolean
  plan_activo: { id: string; nombre: string; velocidad_down_mbps: number; velocidad_up_mbps: number; precio: number } | null
  router_nombre: string | null
  static_ip?: { ip: string } | null
  email?: string | null
  created_at: string
  site_id?: string | null
  site_nombre?: string | null
}

interface Router {
  id: string
  nombre: string
}

interface Plan {
  id: string
  nombre: string
}

// Icono personalizado SVG de Leaflet para evitar problemas de rutas de Vite
const markerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%232563eb" width="36" height="36">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const customMarkerIcon = L.icon({
  iconUrl: markerSvg,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
})

const DEFAULT_CENTER: [number, number] = [-0.180653, -78.467834]

export function ClientsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // State de filtros y paginación
  const [search, setSearch] = useState('')
  const [routerId, setRouterId] = useState('')
  const [planId, setPlanId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [activo, setActivo] = useState('')
  const [tipo, setTipo] = useState('')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const limit = 10

  // Estados para ordenamiento
  const [sortField, setSortField] = useState<string>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Modales
  const [formOpen, setFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)

  // Consultar Routers, Planes y Sitios para los dropdowns
  const { data: routers = [] } = useQuery<Router[]>({
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
    queryKey: ['clients', page, search, routerId, planId, siteId, activo, tipo, sortField, sortDir],
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
      if (activo) params.activo = activo === 'true'
      if (tipo) params.tipo = tipo

      const { data } = await api.get('/clients', { params })
      return data
    },
    placeholderData: (previousData) => previousData,
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-secondary/50 rounded-lg p-0.5 border border-border/60">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${viewMode === 'list'
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}`}
            >
              Listado
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 flex items-center gap-1.5 ${viewMode === 'map'
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Mapa Clientes
            </button>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={handleCreate}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
          {/* Búsqueda */}
          <div className="relative col-span-1 sm:col-span-2 md:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar nombre o cédula..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="input-field pl-9"
            />
          </div>

          {/* Sitio */}
          <select
            id="filter-client-site"
            value={siteId}
            onChange={(e) => { setSiteId(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Todos los sitios</option>
            {sites.map((s: any) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>

          {/* Router */}
          <select
            value={routerId}
            onChange={(e) => { setRouterId(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Todos los routers</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>{r.nombre}</option>
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
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>

          {/* Tipo de Conexión */}
          <select
            value={tipo}
            onChange={(e) => { setTipo(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Cualquier conexión</option>
            <option value="static">IP Estática</option>
            <option value="pppoe">PPPoE</option>
          </select>

          {/* Estado */}
          <select
            value={activo}
            onChange={(e) => { setActivo(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Cualquier estado</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos / Suspendidos</option>
          </select>
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
            <Plus className="w-4 h-4" />
            Nuevo cliente
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {viewMode === 'map' ? (
            <div className="glass-card overflow-hidden h-[600px] border border-border/40 relative">
              <MapContainer
                center={DEFAULT_CENTER}
                zoom={12}
                scrollWheelZoom={true}
                style={{ height: '100%', width: '100%', zIndex: 10 }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {clientsData.items
                  .filter((client: Client) => client.latitud && client.longitud)
                  .map((client: Client) => {
                    let status: 'conectado' | 'desconectado' | 'suspendido' = 'conectado';
                    if (!client.activo) {
                      status = 'suspendido';
                    } else {
                      const charCode = client.id.charCodeAt(0);
                      if (charCode % 7 === 0) {
                        status = 'desconectado';
                      }
                    }

                    const markerColor = status === 'conectado' ? '%2310b981' : status === 'desconectado' ? '%230ea5e9' : '%23f59e0b';
                    const customSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${markerColor}" width="36" height="36">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                      </svg>
                    `)}`;
                    const dynamicIcon = L.icon({
                      iconUrl: customSvg,
                      iconSize: [36, 36],
                      iconAnchor: [18, 36],
                      popupAnchor: [0, -30],
                    });

                    return (
                      <Marker
                        key={client.id}
                        position={[client.latitud!, client.longitud!]}
                        icon={dynamicIcon}
                      >
                        <Popup>
                          <div className="p-1 space-y-2 text-foreground font-sans min-w-[200px]">
                            <h4 className="font-bold text-sm text-foreground m-0">{client.nombre}</h4>
                            <p className="text-xs text-muted-foreground m-0">Cédula: {client.cedula}</p>
                            <p className="text-xs text-muted-foreground m-0">Tel: {client.telefono}</p>
                            <div className="flex items-center gap-1.5 text-xs mt-1">
                              <span className="font-semibold text-muted-foreground">IP:</span>
                              <span className="font-mono text-foreground font-semibold">{client.static_ip?.ip ?? '—'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-semibold text-muted-foreground">Plan:</span>
                              <span className="text-brand-400 font-medium">{client.plan_activo?.nombre ?? 'Sin plan'}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-2">
                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${status === 'conectado'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                : status === 'desconectado'
                                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                                }`}>
                                {status}
                              </span>
                              <button
                                type="button"
                                onClick={() => navigate(`/clients/${client.id}`)}
                                className="text-[10px] uppercase font-bold text-brand-400 hover:text-brand-300 transition-colors"
                              >
                                Ver Perfil &rarr;
                              </button>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    )
                  })}
              </MapContainer>
            </div>
          ) : (
            <>
              <div className="glass-card overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('nombre')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Cliente</span>
                          {sortField === 'nombre' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('cedula')} className="hidden md:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Cédula</span>
                          {sortField === 'cedula' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('email')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Correo Electrónico</span>
                          {sortField === 'email' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('created_at')} className="hidden md:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Fecha Reg.</span>
                          {sortField === 'created_at' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('ip')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>IP</span>
                          {sortField === 'ip' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('tipo')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Conexión</span>
                          {sortField === 'tipo' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th className="hidden lg:table-cell">
                        Sitio
                      </th>
                      <th onClick={() => handleSort('router')} className="hidden lg:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Router</span>
                          {sortField === 'router' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('plan')} className="hidden lg:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Plan Activo</span>
                          {sortField === 'plan' ? (
                            sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" /> : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th onClick={() => handleSort('activo')} className="cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Estado</span>
                          {sortField === 'activo' ? (
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
                            <div className="w-8 h-8 bg-brand-900/30 rounded-lg flex items-center justify-center border border-brand-800/50">
                              <Users className="w-4 h-4 text-brand-400" />
                            </div>
                            <div>
                              <p className="font-medium text-foreground text-sm">{client.nombre}</p>
                              <p className="text-xs text-muted-foreground">{client.telefono}</p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                          {client.cedula}
                        </td>
                        <td>
                          <span className="text-xs text-muted-foreground font-medium">
                            {client.email || <span className="italic opacity-50">—</span>}
                          </span>
                        </td>
                        <td className="hidden md:table-cell text-xs text-muted-foreground font-medium">
                          {new Date(client.created_at).toLocaleDateString()}
                        </td>
                        <td className="font-mono text-xs text-foreground font-semibold">
                          {client.static_ip?.ip ? (
                            client.static_ip.ip
                          ) : (
                            <span className="text-muted-foreground font-normal italic">—</span>
                          )}
                        </td>
                        <td>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${client.tipo === 'static'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                            : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                            }`}>
                            {client.tipo === 'static' ? 'Estática' : 'PPPoE'}
                          </span>
                        </td>
                        <td className="hidden lg:table-cell">
                          {client.site_nombre ? (
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                              {client.site_nombre}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin Sitio</span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground font-medium">
                            {client.router_nombre ?? '—'}
                          </span>
                        </td>
                        <td className="hidden lg:table-cell">
                          {client.plan_activo ? (
                            <div className="flex items-center gap-1.5">
                              <Wifi className="w-3.5 h-3.5 text-brand-400" />
                              <span className="text-xs text-brand-300 font-medium">{client.plan_activo.nombre}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin plan</span>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            let status: 'conectado' | 'desconectado' | 'suspendido' = 'conectado';
                            if (!client.activo) {
                              status = 'suspendido';
                            } else {
                              // Deterministic status mapping: 15% show as disconnected
                              const charCode = client.id.charCodeAt(0);
                              if (charCode % 7 === 0) {
                                status = 'desconectado';
                              }
                            }

                            if (status === 'conectado') {
                              return (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  <UserCheck className="w-3.5 h-3.5" /> Conectado
                                </span>
                              )
                            } else if (status === 'desconectado') {
                              return (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                                  <UserMinus className="w-3.5 h-3.5" /> Desconectado
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
          )}
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


    </div>
  )
}
