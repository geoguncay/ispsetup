// -- Active: 1782457342014@@127.0.0.1@5432@isp_platform
/**
 * ClientsPage — Gestión de clientes del ISP con filtros dinámicos y paginación.
 */
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { ToastContainer } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import {
  Plus, RefreshCw, Search, Users, Wifi, UserCheck, UserX, SlidersHorizontal, MapPin, ArrowUpDown, ChevronUp, ChevronDown,
  Upload, Clock, RotateCcw
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { ClientFormDialog } from '@/components/ClientFormDialog'
import { ClientImportDialog } from '@/components/ClientImportDialog'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'

interface Client {
  id: string
  name: string
  last_name: string | null
  first_name: string | null
  cedula: string
  phone: string
  address: string
  latitude: number | null
  longitude: number | null
  gateway_id: string
  connection_type: 'static' | 'pppoe'
  active: boolean
  scheduled_suspension?: string | null
  scheduled_reactivation?: string | null
  plan_activo: { id: string; name: string; speed_down_mbps: number; speed_up_mbps: number; price: number } | null
  gateway_name: string | null
  static_ip?: { ip: string } | null
  email?: string | null
  created_at: string
  site_id?: string | null
  site_name?: string | null
}

interface GatewayOption {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
}

interface Plan {
  id: string
  name: string
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

const gatewayMarkerIcon = L.divIcon({
  className: '',
  html: `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40">
      <circle cx="12" cy="12" r="12" fill="%232563eb" opacity="0.15"/>
      <circle cx="12" cy="12" r="9" fill="none" stroke="%232563eb" stroke-width="1.5" opacity="0.4"/>
      <path d="M4.93 4.93a10 10 0 0 1 14.14 0M7.76 7.76a6 6 0 0 1 8.49 0M10.59 10.59a2 2 0 0 1 2.83 0" stroke="%232563eb" stroke-width="2" stroke-linecap="round" fill="none"/>
      <circle cx="12" cy="13" r="1.5" fill="%232563eb"/>
      <line x1="12" y1="14.5" x2="12" y2="18" stroke="%232563eb" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -22],
})

function MapController({ clients, selectedGateway, filterKey }: {
  clients: Client[]
  selectedGateway: GatewayOption | undefined
  filterKey: string
}) {
  const map = useMap()
  const lastKey = useRef('')

  useEffect(() => {
    if (lastKey.current === filterKey) return
    lastKey.current = filterKey

    if (selectedGateway?.latitude != null && selectedGateway?.longitude != null) {
      map.flyTo([selectedGateway.latitude, selectedGateway.longitude], 14, { duration: 0.8 })
    } else {
      const first = clients.find(c => c.latitude && c.longitude)
      if (first) map.flyTo([first.latitude!, first.longitude!], 14, { duration: 0.8 })
    }
  }, [filterKey, selectedGateway, clients, map])

  return null
}

export function ClientsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { toasts, addToast, removeToast } = useToast()
  const toastShown = useRef(false)
  const dateFormat = useDateFormat()

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
  const [gatewayId, setGatewayId] = useState('')
  const [planId, setPlanId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [active, setActive] = useState('')
  const [connectionType, setConnectionType] = useState('')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const limit = 10

  // Estados para ordenamiento
  const [sortField, setSortField] = useState<string>('last_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Modales
  const [formOpen, setFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Consultar Routers, Planes y Sitios para los dropdowns
  const { data: gateways = [] } = useQuery<GatewayOption[]>({
    queryKey: ['gateways-list-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/gateways')
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
    queryKey: ['clients', page, search, gatewayId, planId, siteId, active, connectionType, sortField, sortDir],
    queryFn: async () => {
      const params: any = {
        skip: (page - 1) * limit,
        limit: limit,
        sort_by: sortField,
        sort_dir: sortDir,
      }
      if (search.trim()) params.search = search
      if (gatewayId) params.gateway_id = gatewayId
      if (planId) params.plan_id = planId
      if (siteId) params.site_id = siteId
      if (active) params.active = active === 'true'
      if (connectionType) params.connection_type = connectionType

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
              <MapPin className="w-4 h-4" />
              Mapa Clientes
            </button>
          </div>

          <button
            onClick={() => setImportOpen(true)}
            className="btn-secondary"
          >
            <Upload className="w-4 h-4" />
            Importar
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
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
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
          
          {/* Gateway */}
          <select
            value={gatewayId}
            onChange={(e) => { setGatewayId(e.target.value); setPage(1) }}
            className="input-field cursor-pointer"
          >
            <option value="">Todos los gateways</option>
            {gateways.map((r) => (
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
                <MapController
                  clients={clientsData.items}
                  selectedGateway={gateways.find(r => r.id === gatewayId)}
                  filterKey={`${gatewayId}-${siteId}`}
                />
                {/* Marcador del gateway seleccionado */}
                {(() => {
                  const gw = gateways.find(r => r.id === gatewayId)
                  if (!gw?.latitude || !gw?.longitude) return null
                  return (
                    <Marker position={[gw.latitude, gw.longitude]} icon={gatewayMarkerIcon}>
                      <Popup>
                        <div className="p-1 font-sans min-w-[160px]">
                          <p className="font-bold text-sm text-foreground m-0">{gw.name}</p>
                          <p className="text-[11px] text-muted-foreground mt-1 m-0">Gateway · Centro de referencia</p>
                          <p className="text-[10px] font-mono text-muted-foreground mt-0.5 m-0">
                            {gw.latitude.toFixed(5)}, {gw.longitude.toFixed(5)}
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  )
                })()}
                {clientsData.items
                  .filter((client: Client) => client.latitude && client.longitude)
                  .map((client: Client) => {
                    let status: 'active' | 'scheduled_suspension' | 'scheduled_reactivation' | 'suspended' = 'active';
                    if (client.active) {
                      if (client.scheduled_suspension) status = 'scheduled_suspension';
                    } else {
                      status = client.scheduled_reactivation ? 'scheduled_reactivation' : 'suspended';
                    }

                    const markerColor = status === 'active'
                      ? '%2310b981'
                      : status === 'scheduled_suspension'
                        ? '%230ea5e9'
                        : status === 'scheduled_reactivation'
                          ? '%23a855f7'
                          : '%23f59e0b';
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
                        position={[client.latitude!, client.longitude!]}
                        icon={dynamicIcon}
                      >
                        <Popup>
                          <div className="p-1 space-y-2 text-foreground font-sans min-w-[200px]">
                            <h4 className="font-bold text-sm text-foreground m-0">{client.name}</h4>
                            <p className="text-xs text-muted-foreground m-0">Cédula: {client.cedula}</p>
                            <p className="text-xs text-muted-foreground m-0">Tel: {client.phone}</p>
                            <div className="flex items-center gap-1.5 text-xs mt-1">
                              <span className="font-semibold text-muted-foreground">IP:</span>
                              <span className="font-mono text-foreground font-semibold">{client.static_ip?.ip ?? '—'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-semibold text-muted-foreground">Plan:</span>
                              <span className="text-brand-400 font-medium">{client.plan_activo?.name ?? 'Sin plan'}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-2">
                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${status === 'active'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                : status === 'scheduled_suspension'
                                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/25'
                                  : status === 'scheduled_reactivation'
                                    ? 'bg-purple-500/10 text-purple-400 border border-purple-500/25'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                                }`}>
                                {status === 'active' ? 'Activo' : status === 'scheduled_suspension' ? 'Aplazado' : status === 'scheduled_reactivation' ? 'Reactivación prog.' : 'Suspendido'}
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
                      <th onClick={() => handleSort('first_name')} className="hidden sm:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Nombres</span>
                          {sortField === 'first_name' ? (
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
                      <th className="hidden lg:table-cell">
                        Sitio
                      </th>
                      <th onClick={() => handleSort('gateway')} className="hidden lg:table-cell cursor-pointer select-none hover:bg-secondary/20 transition-colors">
                        <div className="flex items-center gap-1">
                          <span>Gateway</span>
                          {sortField === 'gateway' ? (
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
                              {client.last_name || client.name}
                            </span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell text-sm text-muted-foreground">
                          {client.first_name || <span className="italic opacity-40">—</span>}
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
                          {formatDate(client.created_at, dateFormat)}
                        </td>
                        <td className="font-mono text-xs text-foreground font-semibold">
                          {client.static_ip?.ip ? (
                            client.static_ip.ip
                          ) : (
                            <span className="text-muted-foreground font-normal italic">—</span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell">
                          {client.site_name ? (
                            <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                              {client.site_name}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin Sitio</span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground font-medium">
                            {client.gateway_name ?? '—'}
                          </span>
                        </td>
                        <td className="hidden lg:table-cell">
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
                                  title={`Suspensión programada: ${new Date(client.scheduled_suspension!).toLocaleString()}`}
                                >
                                  <Clock className="w-3.5 h-3.5" /> Aplazado
                                </span>
                              )
                            } else if (status === 'scheduled_reactivation') {
                              return (
                                <span
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                  title={`Reactivación programada: ${new Date(client.scheduled_reactivation!).toLocaleString()}`}
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
