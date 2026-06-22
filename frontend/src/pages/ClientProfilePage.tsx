/**
 * ClientProfilePage — Ficha del cliente, historial de planes, acciones de red y mapa de ubicación GPS.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, RefreshCw, MapPin, Phone, Shield, User,
  Wifi, Calendar, CheckCircle2, XCircle, AlertCircle, Loader2, X, Mail, Plus, MessageSquare,
  Edit2, Trash2, FileText, Download, UploadCloud
} from 'lucide-react'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { ClientFormDialog } from '@/components/ClientFormDialog'
import TrafficChart from '@/components/TrafficChart'

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
})

interface ClientPlan {
  id: string
  cliente_id: string
  plan_id: string
  fecha_inicio: string
  fecha_fin: string | null
  estado: string
  plan: { nombre: string; velocidad_down_mbps: number; velocidad_up_mbps: number; precio: number } | null
}

export function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<'plans' | 'suspensions' | 'payments' | 'tickets' | 'traffic' | 'documents'>('traffic')
  const [isUploading, setIsUploading] = useState(false)
  const [documents, setDocuments] = useState([
    { id: '1', nombre: 'Contrato_de_Servicio_WISP.pdf', tamaño: '1.2 MB', fecha: '2026-05-10' },
    { id: '2', nombre: 'Cedula_Identidad_Scan.pdf', tamaño: '840 KB', fecha: '2026-05-10' },
    { id: '3', nombre: 'Croquis_Instalacion.png', tamaño: '2.4 MB', fecha: '2026-05-12' },
  ])
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [suspensionReason, setSuspensionReason] = useState('')


  // Ticket creation form state
  const [createTicketOpen, setCreateTicketOpen] = useState(false)
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDesc, setTicketDesc] = useState('')
  const [ticketPriority, setTicketPriority] = useState('media')

  // Edit and Delete client state & mutation
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const deleteClientMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al eliminar el cliente de la base de datos'
      alert(msg)
    }
  })

  // Consultar Cliente
  const { data: client, isLoading, isError, refetch } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}`)
      return data
    }
  })

  // Consultar Estado de Sesión PPPoE (solo si es PPPoE y el router_id está disponible)
  const { data: pppoeSessions = [], refetch: refetchSessions } = useQuery<any[]>({
    queryKey: ['router-pppoe-sessions', client?.router_id],
    queryFn: async () => {
      if (!client?.router_id) return []
      const { data } = await api.get(`/routers/${client.router_id}/pppoe-sessions`)
      return data
    },
    enabled: !!client && client.tipo === 'pppoe' && !!client.router_id,
    refetchInterval: 10000, // Refrescar cada 10 s
  })

  // Buscar la sesión correspondiente a este cliente
  const activeSession = pppoeSessions.find(
    (s) => s.username === client?.pppoe_secret?.usuario_ppp
  )

  // Mutación para desconectar sesión activa
  const disconnectSessionMutation = useMutation({
    mutationFn: async () => {
      if (!client?.router_id || !client?.pppoe_secret?.usuario_ppp) return
      await api.delete(`/routers/${client.router_id}/pppoe-sessions/${client.pppoe_secret.usuario_ppp}`)
    },
    onSuccess: () => {
      refetchSessions()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al desconectar la sesión activa'
      alert(msg)
    }
  })

  // Consultar Historial de Planes
  const { data: planHistory = [], isLoading: isLoadingHistory } = useQuery<ClientPlan[]>({
    queryKey: ['client-plans', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/plans`)
      return data
    }
  })

  // Consultar Historial de Pagos
  const { data: payments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['client-payments', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/payments`)
      return data
    }
  })

  // Consultar Tickets de Soporte
  const { data: tickets = [], isLoading: isLoadingTickets } = useQuery({
    queryKey: ['client-tickets', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/tickets`)
      return data
    }
  })

  // Estados y Consultas para Tráfico (En vivo / Histórico)
  const [trafficRange, setTrafficRange] = useState<'live' | '1h' | '24h' | '7d' | '30d'>('live')
  const [liveTraffic, setLiveTraffic] = useState<any[]>([])

  const { data: historicalTraffic = null, isLoading: isLoadingHistorical } = useQuery({
    queryKey: ['client-traffic-historical', id, trafficRange],
    queryFn: async () => {
      const { data } = await api.get(`/traffic/client/${id}`, {
        params: { range: trafficRange }
      })
      return data
    },
    enabled: trafficRange !== 'live'
  })

  useEffect(() => {
    if (trafficRange !== 'live' || !client?.router_id) return

    const wsUrl = (() => {
      const token = localStorage.getItem('access_token') || ''
      const apiHost = import.meta.env.VITE_API_URL
      let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      let wsHost = window.location.host
      if (apiHost) {
        try {
          const url = new URL(apiHost)
          wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
          wsHost = url.host
        } catch {}
      }
      return `${wsProtocol}//${wsHost}/api/traffic/ws/${client.router_id}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const timestamp = payload.timestamp
        const clients = payload.clients || []
        const mySample = clients.find((c: any) => c.cliente_id === id)

        setLiveTraffic((prev) => {
          const newPoint = {
            timestamp,
            rx_rate: mySample ? mySample.rx_rate : 0,
            tx_rate: mySample ? mySample.tx_rate : 0,
          }
          const nextPoints = [...prev, newPoint]
          return nextPoints.length > 30 ? nextPoints.slice(nextPoints.length - 30) : nextPoints
        })
      } catch (err) {
        console.error("Error en WebSocket de tráfico de cliente:", err)
      }
    }

    return () => {
      ws.close()
    }
  }, [id, client?.router_id, trafficRange])

  // Mutación para Registrar Ticket
  const createTicketMutation = useMutation({
    mutationFn: async (payload: { titulo: string; descripcion: string; prioridad: string }) => {
      await api.post(`/clients/${id}/tickets`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-tickets', id] })
      setCreateTicketOpen(false)
      setTicketTitle('')
      setTicketDesc('')
      setTicketPriority('media')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al registrar ticket'
      alert(msg)
    }
  })

  // Consultar lista de Planes disponibles para el dropdown de cambio de plan
  const { data: availablePlans = [] } = useQuery({
    queryKey: ['available-plans-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/plans')
      return data
    },
    enabled: changePlanOpen
  })

  // Mutación para Cambiar Plan
  const changePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      await api.post(`/clients/${id}/assign-plan`, null, { params: { plan_id: planId } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      setChangePlanOpen(false)
      setSelectedPlanId('')
      setErrorMessage(null)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al cambiar de plan'
      setErrorMessage(msg)
    }
  })

  // Mutación para suspender cliente
  const suspendClientMutation = useMutation({
    mutationFn: async (reason: string) => {
      await api.post(`/clients/${id}/suspend`, null, { params: { motivo: reason } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-suspensions', id] })
      setSuspendOpen(false)
      setSuspensionReason('')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al suspender al cliente'
      alert(msg)
    }
  })

  // Mutación para reactivar cliente
  const reactivateClientMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/clients/${id}/reactivate`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-suspensions', id] })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al reactivar al cliente'
      alert(msg)
    }
  })

  // Consultar Historial de Suspensiones
  const { data: suspensionHistory = [], isLoading: isLoadingSuspensions } = useQuery({
    queryKey: ['client-suspensions', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/suspensions`)
      return data
    }
  })



  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando ficha del cliente...</span>
        </div>
      </div>
    )
  }

  if (isError || !client) {
    return (
      <div className="glass-card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Error al cargar el cliente</h3>
        <p className="text-muted-foreground text-sm mb-6">
          El cliente que intentas consultar no existe o no tienes permisos de acceso.
        </p>
        <button onClick={() => navigate('/clients')} className="btn-primary mx-auto">
          <ArrowLeft className="w-4 h-4" />
          Volver a clientes
        </button>
      </div>
    )
  }

  const handleToggleStatus = () => {
    if (client.activo) {
      setSuspendOpen(true)
    } else {
      reactivateClientMutation.mutate()
    }
  }

  const handleAssignPlan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPlanId) return
    changePlanMutation.mutate(selectedPlanId)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Botón Volver y Acciones */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/clients')}
          className="btn-secondary text-xs py-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Clientes
        </button>
        <div className="flex items-center gap-2">
          {/* Botón Editar Cliente */}
          <button
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-secondary hover:bg-secondary/80 border border-border/80 text-foreground transition-all duration-200"
          >
            <Edit2 className="w-3.5 h-3.5 text-brand-400" />
            <span>Editar Cliente</span>
          </button>

          {/* Botón Eliminar Cliente */}
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 transition-all duration-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Eliminar Cliente</span>
          </button>

          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border/80 text-muted-foreground hover:text-foreground transition-all duration-200"
            title="Recargar datos"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Columna Izquierda: Información del Cliente */}
        <div className="lg:col-span-2 space-y-6">

          {/* Card Detalle */}
          <div className="glass-card p-6 relative">

            {/* Badge de estado y toggle */}
            <div className="absolute top-6 right-6 flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${client.activo
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                }`}>
                {client.activo ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {client.activo ? 'Activo' : 'Suspendido'}
              </span>
              <button
                onClick={handleToggleStatus}
                disabled={suspendClientMutation.isPending || reactivateClientMutation.isPending}
                className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 ${client.activo
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/25'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/25'
                  }`}
              >
                {suspendClientMutation.isPending || reactivateClientMutation.isPending
                  ? 'Cargando...'
                  : client.activo ? 'Suspender' : 'Reactivar'}
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-1">{client.nombre}</h1>
                <p className="text-xs text-muted-foreground font-mono">ID: {client.id}</p>
              </div>

              {/* Grid Datos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/50 pt-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Cédula</p>
                    <p className="text-sm font-semibold text-foreground font-mono">{client.cedula}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Phone className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Teléfono</p>
                    <p className="text-sm font-semibold text-foreground">{client.telefono}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Correo Electrónico</p>
                    <p className="text-sm font-semibold text-foreground">{client.email || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Dirección</p>
                    <p className="text-sm font-semibold text-foreground">{client.direccion}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Wifi className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Tipo de Conexión</p>
                    <p className="text-sm font-semibold text-foreground font-sans">
                      <span className="capitalize">{client.tipo === 'static' ? 'IP Estática' : 'PPPoE'}</span>
                      <span className="text-muted-foreground text-xs font-normal"> en {client.router_nombre ?? 'Router Desconocido'}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Sitio / Ubicación</p>
                    <p className="text-sm font-semibold text-foreground">
                      {client.site_nombre ? (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                          {client.site_nombre}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sin Sitio</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Fecha de Registro</p>
                    <p className="text-sm font-semibold text-foreground">
                      {new Date(client.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Información de Red (solo si es estática) */}
              {client.tipo === 'static' && (
                <div className="border-t border-border/50 pt-4 mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Información de Red</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-secondary/20 p-3 rounded-lg border border-border/40 font-sans">
                    <div className="flex items-start gap-3">
                      <Wifi className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Dirección IP</p>
                        <p className="text-sm font-semibold text-foreground font-mono">
                          {client.static_ip?.ip ?? 'No asignada'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Shield className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Dirección MAC</p>
                        <p className="text-sm font-semibold text-foreground font-mono">
                          {client.static_ip?.mac ?? 'No registrada'}
                        </p>
                      </div>
                    </div>

                    {client.static_ip?.notas && (
                      <div className="flex items-start gap-3 sm:col-span-2 border-t border-border/30 pt-2.5 mt-1 font-sans">
                        <AlertCircle className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-muted-foreground">Notas</p>
                          <p className="text-sm text-foreground">{client.static_ip.notas}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Información de PPPoE (solo si es pppoe) */}
              {client.tipo === 'pppoe' && (
                <div className="border-t border-border/50 pt-4 mt-4 space-y-3 font-sans">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Credenciales y Sesión PPPoE</h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-secondary/20 p-3 rounded-lg border border-border/40">
                    <div className="flex items-start gap-3">
                      <User className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Usuario PPPoE</p>
                        <p className="text-sm font-semibold text-foreground font-mono">
                          {client.pppoe_secret?.usuario_ppp ?? 'No configurado'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Shield className="w-4 h-4 text-brand-400 mt-1 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Contraseña PPPoE</p>
                        <p className="text-sm font-semibold text-foreground font-mono">
                          {client.pppoe_secret?.contraseña_ppp ?? 'No configurada'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Estado de la Sesión en tiempo real */}
                  <div className="bg-secondary/10 p-4 rounded-lg border border-border/30 mt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase">Estado de Sesión Activa</span>
                      {activeSession ? (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25">
                          ● Conectado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-muted-foreground px-2 py-0.5 rounded-full bg-secondary border border-border">
                          Desconectado
                        </span>
                      )}
                    </div>

                    {activeSession ? (
                      <div className="space-y-3 animate-fade-in">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Dirección IP Asignada</span>
                            <span className="text-xs font-semibold text-foreground font-mono">{activeSession.ip_address}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Tiempo de Conexión</span>
                            <span className="text-xs font-semibold text-foreground font-mono">{activeSession.uptime || '—'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Dirección MAC</span>
                            <span className="text-xs font-semibold text-foreground font-mono">{activeSession.caller_id || '—'}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/20">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Tráfico Descarga (RX)</span>
                            <span className="text-xs font-bold text-emerald-400 font-mono">↓ {activeSession.bytes_rx_human || '0 B'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Tráfico Subida (TX)</span>
                            <span className="text-xs font-bold text-blue-400 font-mono">↑ {activeSession.bytes_tx_human || '0 B'}</span>
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`¿Estás seguro de que deseas desconectar la sesión activa de ${client.pppoe_secret?.usuario_ppp}?`)) {
                                disconnectSessionMutation.mutate()
                              }
                            }}
                            disabled={disconnectSessionMutation.isPending}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 transition-all active:scale-[0.98]"
                          >
                            {disconnectSessionMutation.isPending ? 'Desconectando...' : 'Desconectar Sesión (Kick)'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">El cliente no tiene una sesión activa en este momento.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tabs Historiales */}
          <div className="glass-card overflow-hidden">
            {/* Header Tabs */}
            <div className="flex border-b border-border bg-secondary/20">
              {[
                { id: 'traffic', label: 'Estadísticas' },
                { id: 'payments', label: 'Facturación' },
                { id: 'plans', label: 'Servicios' },
                { id: 'suspensions', label: 'Suspensiones' },
                { id: 'tickets', label: 'Tickets' },
                { id: 'documents', label: 'Documentos' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-5 py-3 text-sm font-medium transition-all duration-150 ${activeTab === tab.id
                    ? 'border-b-2 border-brand-500 text-brand-400 bg-secondary/10'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content Tabs */}
            <div className="p-5">

              {activeTab === 'traffic' && (
                <div className="space-y-6 font-sans animate-fade-in">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Consumo de Ancho de Banda</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Monitoreo en tiempo real del tráfico de subida y bajada del cliente.
                      </p>
                    </div>

                    {/* Selector de Rango */}
                    <div className="flex bg-secondary/30 p-0.5 rounded-lg border border-border/40">
                      {[
                        { id: 'live', label: 'En Vivo' },
                        { id: '1h', label: '1 Hora' },
                        { id: '24h', label: '24 Horas' },
                        { id: '7d', label: '7 Días' },
                        { id: '30d', label: '30 Días' },
                      ].map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setTrafficRange(r.id as any)
                            if (r.id === 'live') {
                              setLiveTraffic([])
                            }
                          }}
                          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                            trafficRange === r.id
                              ? 'bg-primary text-primary-foreground shadow'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {trafficRange === 'live' ? (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 min-h-[300px]">
                      {liveTraffic.length === 0 ? (
                        <div className="h-[300px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                          <p className="text-xs font-medium">Esperando datos del colector...</p>
                        </div>
                      ) : (
                        <TrafficChart data={liveTraffic} range="live" height={300} />
                      )}
                    </div>
                  ) : isLoadingHistorical ? (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 h-[340px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                      <p className="text-xs font-medium">Cargando datos históricos...</p>
                    </div>
                  ) : !historicalTraffic || !historicalTraffic.samples || historicalTraffic.samples.length === 0 ? (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 h-[340px] flex flex-col items-center justify-center text-muted-foreground text-center">
                      <p className="text-sm font-medium">No se encontraron estadísticas de tráfico para el rango seleccionado.</p>
                      <p className="text-xs text-muted-foreground mt-1">El colector podría no tener suficientes datos almacenados.</p>
                    </div>
                  ) : (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 min-h-[300px]">
                      <TrafficChart data={historicalTraffic.samples} range={trafficRange} height={300} />
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'payments' && (
                isLoadingPayments ? (
                  <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Cargando pagos...
                  </div>
                ) : payments.length === 0 ? (
                  <p className="text-center py-6 text-sm text-muted-foreground">Sin pagos registrados.</p>
                ) : (
                  <div className="overflow-x-auto font-sans">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Monto</th>
                          <th>Método</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p: any) => (
                          <tr key={p.id}>
                            <td className="text-xs text-muted-foreground font-mono">
                              {new Date(p.fecha_pago).toLocaleDateString()} {new Date(p.fecha_pago).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="font-mono text-sm font-bold text-brand-400">${Number(p.monto).toFixed(2)}</td>
                            <td className="text-xs capitalize text-foreground font-medium">{p.metodo}</td>
                            <td>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${p.estado === 'completado'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                : p.estado === 'pendiente'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                                }`}>
                                {p.estado}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {activeTab === 'plans' && (
                isLoadingHistory ? (
                  <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Cargando historial...
                  </div>
                ) : planHistory.length === 0 ? (
                  <p className="text-center py-6 text-sm text-muted-foreground">Sin historial de planes asignados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Plan</th>
                          <th>Precio</th>
                          <th>Fecha Inicio</th>
                          <th>Fecha Fin</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planHistory.map((ph) => (
                          <tr key={ph.id}>
                            <td className="font-semibold text-foreground text-sm">{ph.plan?.nombre ?? 'Plan Eliminado'}</td>
                            <td className="font-mono text-xs">${ph.plan ? Number(ph.plan.precio).toFixed(2) : '0.00'}</td>
                            <td className="text-xs text-muted-foreground">{new Date(ph.fecha_inicio).toLocaleDateString()}</td>
                            <td className="text-xs text-muted-foreground">
                              {ph.fecha_fin ? new Date(ph.fecha_fin).toLocaleDateString() : <span className="text-emerald-400 font-medium">Actual</span>}
                            </td>
                            <td>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ph.estado === 'activo'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : ph.estado === 'suspendido'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                  : 'bg-muted text-muted-foreground border border-border'
                                }`}>
                                {ph.estado}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {activeTab === 'suspensions' && (
                isLoadingSuspensions ? (
                  <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Cargando historial...
                  </div>
                ) : suspensionHistory.length === 0 ? (
                  <p className="text-center py-6 text-sm text-muted-foreground">Sin historial de suspensiones.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table font-sans">
                      <thead>
                        <tr>
                          <th>Motivo</th>
                          <th>Fecha Suspensión</th>
                          <th>Fecha Reactivación</th>
                          <th>Creador / Operador</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suspensionHistory.map((sh: any) => (
                          <tr key={sh.id}>
                            <td className="text-sm font-semibold text-foreground max-w-xs truncate" title={sh.motivo}>
                              {sh.motivo}
                            </td>
                            <td className="text-xs text-muted-foreground font-mono">
                              {new Date(sh.fecha_suspension).toLocaleDateString()} {new Date(sh.fecha_suspension).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="text-xs text-muted-foreground font-mono">
                              {sh.fecha_reactivacion ? (
                                `${new Date(sh.fecha_reactivacion).toLocaleDateString()} ${new Date(sh.fecha_reactivacion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                              ) : (
                                <span className="text-rose-400 font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-[10px]">Suspendido</span>
                              )}
                            </td>
                            <td className="text-xs text-foreground font-medium">
                              {sh.usuario_nombre ? (
                                <span>{sh.usuario_nombre} <span className="text-muted-foreground text-[10px]">(Manual)</span></span>
                              ) : (
                                <span className="text-brand-400 font-bold text-[10px] uppercase tracking-wider bg-brand-500/10 px-2 py-0.5 rounded-full border border-brand-500/25">Sistema</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {activeTab === 'tickets' && (
                <div className="space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Tickets del Cliente</h3>
                    <button
                      onClick={() => setCreateTicketOpen(true)}
                      className="btn-primary text-xs py-1.5 px-3 h-auto"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Nuevo Ticket
                    </button>
                  </div>

                  {isLoadingTickets ? (
                    <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Cargando tickets...
                    </div>
                  ) : tickets.length === 0 ? (
                    <p className="text-center py-6 text-sm text-muted-foreground">No hay tickets de soporte registrados.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {tickets.map((t: any) => (
                        <div key={t.id} className="glass-card p-4 hover:border-brand-500/20 transition-all duration-200 border border-border/40 relative">
                          <div className="absolute top-4 right-4 flex items-center gap-2">
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${t.prioridad === 'alta'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : t.prioridad === 'media'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                              {t.prioridad}
                            </span>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${t.estado === 'resuelto'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : t.estado === 'abierto'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                              {t.estado}
                            </span>
                          </div>

                          <div className="pr-24 space-y-1">
                            <h4 className="text-sm font-semibold text-foreground">{t.titulo}</h4>
                            <p className="text-xs text-muted-foreground font-mono">
                              Creado: {new Date(t.created_at).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-3 leading-relaxed">{t.descripcion}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'documents' && (
                <div className="space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Documentos del Cliente</h3>
                    <div className="relative">
                      <input
                        type="file"
                        id="file-upload"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setIsUploading(true);
                            setTimeout(() => {
                              setDocuments((prev) => [
                                ...prev,
                                {
                                  id: String(Date.now()),
                                  nombre: file.name,
                                  tamaño: file.size > 1024 * 1024
                                    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                                    : `${(file.size / 1024).toFixed(0)} KB`,
                                  fecha: new Date().toISOString().split('T')[0],
                                }
                              ]);
                              setIsUploading(false);
                            }, 1000);
                          }
                        }}
                      />
                      <label
                        htmlFor="file-upload"
                        className="btn-primary text-xs py-1.5 px-3 h-auto cursor-pointer flex items-center gap-1.5"
                      >
                        {isUploading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UploadCloud className="w-3.5 h-3.5" />
                        )}
                        {isUploading ? 'Subiendo...' : 'Subir Documento'}
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="glass-card p-4 flex items-center justify-between border border-border/40 hover:border-brand-500/20 transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-brand-900/30 rounded-lg flex items-center justify-center border border-brand-800/50">
                            <FileText className="w-5 h-5 text-brand-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground truncate max-w-[180px] sm:max-w-[240px]">
                              {doc.nombre}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {doc.tamaño} • {new Date(doc.fecha).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              alert(`Descargando archivo: ${doc.nombre}`);
                            }}
                            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            title="Descargar archivo"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                            }}
                            className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
                            title="Eliminar archivo"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {documents.length === 0 && (
                      <div className="col-span-full py-12 text-center border border-dashed border-border rounded-lg">
                        <FileText className="w-12 h-12 mx-auto text-muted-foreground/45 mb-3" />
                        <p className="text-sm font-medium text-foreground">No hay documentos cargados</p>
                        <p className="text-xs text-muted-foreground mt-1">Sube contratos, copias de cédula u otros archivos para este cliente.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Columna Derecha: Plan Activo y Ubicación GPS */}
        <div className="space-y-6">

          {/* Card Plan Activo */}
          <div className="glass-card p-5 border border-brand-500/10 hover:border-brand-500/20 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Plan Contratado</span>
              <Wifi className="w-4 h-4 text-brand-400" />
            </div>

            {client.plan_activo ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-foreground">{client.plan_activo.nombre}</h3>
                  <div className="flex items-baseline gap-1 mt-1 text-2xl font-mono font-bold text-brand-400">
                    <span>${Number(client.plan_activo.precio).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground font-normal font-sans">/mes</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50 font-mono text-muted-foreground">
                  <div>Bajada: <span className="text-foreground font-semibold">{client.plan_activo.velocidad_down_mbps} Mbps</span></div>
                  <div>Subida: <span className="text-foreground font-semibold">{client.plan_activo.velocidad_up_mbps} Mbps</span></div>
                </div>

                <button
                  onClick={() => { setErrorMessage(null); setChangePlanOpen(true) }}
                  className="btn-primary w-full justify-center text-xs py-2"
                >
                  Cambiar Plan
                </button>
              </div>
            ) : (
              <div className="space-y-4 py-2 text-center">
                <p className="text-sm text-muted-foreground">Este cliente no tiene ningún plan activo asignado.</p>
                <button
                  onClick={() => { setErrorMessage(null); setChangePlanOpen(true) }}
                  className="btn-primary w-full justify-center text-xs py-2"
                >
                  Asignar primer plan
                </button>
              </div>
            )}
          </div>

          {/* Card Mapa GPS */}
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Geolocalización GPS</span>
              <MapPin className="w-4 h-4 text-brand-400" />
            </div>

            {client.latitud && client.longitud ? (
              <div className="space-y-3">
                <div className="rounded-lg overflow-hidden border border-border h-48">
                  <MapContainer
                    center={[client.latitud, client.longitud]}
                    zoom={14}
                    scrollWheelZoom={false}
                    dragging={false}
                    zoomControl={false}
                    style={{ height: '100%', width: '100%', zIndex: 10 }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[client.latitud, client.longitud]} icon={customMarkerIcon} />
                  </MapContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground text-center">
                  <div className="bg-secondary/40 p-1.5 rounded">Lat: {client.latitud}</div>
                  <div className="bg-secondary/40 p-1.5 rounded">Lng: {client.longitud}</div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                <MapPin className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-xs">No hay coordenadas GPS guardadas para este cliente.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Cambiar Plan */}
      {changePlanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Asignar Plan de Internet</h2>
              <button
                onClick={() => setChangePlanOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignPlan} className="p-5 space-y-4">
              {errorMessage && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
                  {errorMessage}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Seleccionar plan de velocidad *</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  required
                  className="input-field cursor-pointer"
                >
                  <option value="">Seleccione un plan</option>
                  {availablePlans.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nombre} (${Number(p.precio).toFixed(2)})</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setChangePlanOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={changePlanMutation.isPending || !selectedPlanId}
                  className="btn-primary flex-1 justify-center"
                >
                  {changePlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {changePlanMutation.isPending ? 'Procesando...' : 'Asignar Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal Crear Ticket */}
      {createTicketOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-brand-400" />
                Registrar Ticket de Soporte
              </h2>
              <button
                type="button"
                onClick={() => setCreateTicketOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!ticketTitle || !ticketDesc) return
                createTicketMutation.mutate({
                  titulo: ticketTitle,
                  descripcion: ticketDesc,
                  prioridad: ticketPriority
                })
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Título del Problema *</label>
                <input
                  type="text"
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  placeholder="Ej: Intermitencia de señal, lentitud..."
                  required
                  className="input-field"
                />
              </div>

              <div className="grid grid-cols-1 gap-2">
                <label className="block text-sm font-medium text-foreground mb-0.5">Prioridad *</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value)}
                  className="input-field cursor-pointer"
                >
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Descripción Detallada *</label>
                <textarea
                  value={ticketDesc}
                  onChange={(e) => setTicketDesc(e.target.value)}
                  placeholder="Describe los detalles de la falla reportada..."
                  required
                  rows={4}
                  className="input-field resize-none py-2 font-sans"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateTicketOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createTicketMutation.isPending || !ticketTitle || !ticketDesc}
                  className="btn-primary flex-1 justify-center"
                >
                  {createTicketMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {createTicketMutation.isPending ? 'Procesando...' : 'Crear Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dialog para Editar Cliente */}
      <ClientFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        client={client}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['client', id] })
          setEditOpen(false)
        }}
      />

      {/* Modal Confirmar Eliminación */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-destructive/20">
            <div className="flex items-center gap-2.5 text-destructive mb-3">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Eliminar cliente definitivamente?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
              Esta acción es <strong>irreversible</strong> y eliminará al cliente <strong>{client.nombre}</strong> de la base de datos de manera permanente, junto con todo su historial.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteClientMutation.mutate()}
                disabled={deleteClientMutation.isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {deleteClientMutation.isPending ? 'Eliminando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Suspensión */}
      {suspendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-rose-500/20">
            <div className="flex items-center gap-2.5 text-rose-400 p-5 border-b border-border">
              <XCircle className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Suspender Servicio</h2>
            </div>
            
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!suspensionReason.trim()) return
                suspendClientMutation.mutate(suspensionReason)
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                El servicio del cliente <strong>{client.nombre}</strong> será suspendido en la base de datos y se bloqueará su acceso en el router MikroTik.
              </p>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Motivo de la Suspensión
                </label>
                <input
                  type="text"
                  value={suspensionReason}
                  onChange={(e) => setSuspensionReason(e.target.value)}
                  placeholder="Ej: Falta de pago mensual, Solicitud temporal..."
                  required
                  className="input-field"
                />
              </div>

              {/* Botones de Selección Rápida */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Sugerencias rápidas
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['Falta de pago', 'Retiro voluntario', 'Incumplimiento de contrato'].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setSuspensionReason(reason)}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-secondary hover:bg-secondary/80 border border-border/60 text-foreground transition-all duration-150"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSuspendOpen(false)
                    setSuspensionReason('')
                  }}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={suspendClientMutation.isPending || !suspensionReason.trim()}
                  className="btn-primary flex-1 justify-center bg-rose-600 hover:bg-rose-700 text-white"
                >
                  {suspendClientMutation.isPending ? 'Suspendiendo...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
