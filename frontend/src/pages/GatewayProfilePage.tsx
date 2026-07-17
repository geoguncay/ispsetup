/**
 * GatewayProfilePage — Ficha del gateway, listado de clientes asociados, ubicación geográfica y configuración de MikroTik.
 */
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, RefreshCw, MapPin, Wifi, Server,
  CheckCircle2, XCircle, Sliders, AlertCircle, Loader2, X,
  Edit2, Download, Search, Users, Network, Activity, ScrollText, ClipboardList,
  WifiOff, UserPlus, UserX, UserCheck, Zap, ToggleLeft, Settings2,
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { GatewayStatusBadge } from '@/components/GatewayStatusBadge'
import { GatewayFormDialog } from '@/components/GatewayFormDialog'
import { GatewayServicesDialog } from '@/components/GatewayServicesDialog'
import { useAuthStore } from '@/stores/authStore'
import { formatUptime } from '@/lib/utils'
import { formatSpeed } from '@/components/TrafficChart'

// Icono personalizado violeta para el Router
const gatewaySvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238b5cf6" width="38" height="38">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const gatewayIcon = L.icon({
  iconUrl: gatewaySvg,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -32],
})

// Helper to format a queue limit string (e.g. "10M/20M") into a friendly text (e.g. "↑ 10 MB / ↓ 20 MB")
function formatQueueLimit(maxLimit: string | undefined): string {
  if (!maxLimit || maxLimit === '0/0') return 'Ilimitado'
  const parts = maxLimit.split('/')
  if (parts.length !== 2) return maxLimit

  const formatPart = (valStr: string): string => {
    valStr = valStr.toUpperCase().trim()
    if (valStr.endsWith('G')) {
      return `${valStr.slice(0, -1)} GB`
    }
    if (valStr.endsWith('M')) {
      return `${valStr.slice(0, -1)} MB`
    }
    if (valStr.endsWith('K')) {
      return `${valStr.slice(0, -1)} KB`
    }
    const num = Number(valStr)
    if (!isNaN(num) && num > 0) {
      if (num >= 1024 * 1024 * 1024) {
        return `${(num / (1024 * 1024 * 1024)).toFixed(0)} GB`
      }
      if (num >= 1024 * 1024) {
        return `${(num / (1024 * 1024)).toFixed(0)} MB`
      }
      if (num >= 1024) {
        return `${(num / 1024).toFixed(0)} KB`
      }
      return `${num} B`
    }
    return valStr
  }

  return `↑ ${formatPart(parts[0])} / ↓ ${formatPart(parts[1])}`
}

// Helper to parse speed limits in Mbps from a queue limit string (e.g., "10M/20M")
// Returns [upload_mbps, download_mbps]
function parseMaxLimit(maxLimit: string | undefined): [number, number] {
  if (!maxLimit) return [0, 0]
  const parts = maxLimit.split('/')
  if (parts.length !== 2) return [0, 0]

  const parsePart = (valStr: string): number => {
    valStr = valStr.toUpperCase().trim()
    if (valStr.endsWith('G')) {
      return parseFloat(valStr.slice(0, -1)) * 1024
    }
    if (valStr.endsWith('M')) {
      return parseFloat(valStr.slice(0, -1))
    }
    if (valStr.endsWith('K')) {
      return parseFloat(valStr.slice(0, -1)) / 1024
    }
    const num = parseFloat(valStr)
    if (!isNaN(num)) {
      return num / 1000000
    }
    return 0
  }

  return [parsePart(parts[0]), parsePart(parts[1])]
}

// Helper to format raw bytes into MB / GB / TB
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(2)} TB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

// Helper to format dynamic assigned bandwidth dynamically (e.g. 1500 Mbps -> 1.5 GB)
function formatBandwidth(mbps: number): string {
  if (mbps >= 1024) {
    const gb = mbps / 1024
    return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} GB`
  }
  return `${mbps.toFixed(0)} MB`
}

interface Client {
  id: string
  name: string
  cedula: string
  phone: string
  connection_type: 'static' | 'pppoe'
  active: boolean
  latitude: number | null
  longitude: number | null
  plan_activo?: { name: string; speed_down_mbps?: number; speed_up_mbps?: number } | null
  static_ip?: { ip: string } | null
}

interface TestResult {
  success: boolean
  message: string
  ros_version?: string
  uptime?: string
  error?: string
}

type GatewayProfileTab = 'stats' | 'clients' | 'queues' | 'pppoe' | 'logs' | 'historial'

const SECURITY_MODE_LABELS: Record<string, string> = {
  none_api: 'Sin autenticación · API',
  ppp_api: 'PPP · API',
  hotspot_api: 'Hotspot · API',
  ppp_radius: 'PPP · Radius',
  hotspot_radius: 'Hotspot · Radius',
}

const TRAFFIC_ACCOUNTING_LABELS: Record<string, string> = {
  traffic_flow: 'Traffic Flow',
  accounting_v6: 'Accounting v6',
}

const SPEED_CONTROL_LABELS: Record<string, string> = {
  pcq_addresslist: 'PCQ + Address List',
  simple_queues: 'Colas simples',
  dhcp_lease_dynamic: 'DHCP + colas dinámicas',
  none: 'Sin control de velocidad',
}

interface DonutChartProps {
  percentage: number
  title: string
  label1: string
  val1: string | number
  color1: string
  label2: string
  val2: string | number
  color2: string
  centerLabel: string
  centerSublabel: string
}

function DonutChart({
  percentage,
  title,
  label1,
  val1,
  color1,
  label2,
  val2,
  color2,
  centerLabel,
  centerSublabel
}: DonutChartProps) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 space-y-4 flex flex-col items-center">
      <h4 className="text-sm font-semibold text-foreground self-start">{title}</h4>

      <div className="relative w-36 h-36 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          {/* Base Circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={color2}
            strokeWidth="10"
          />
          {/* Main Circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={color1}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Center Text */}
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-lg font-extrabold text-foreground">{centerLabel}</span>
          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">{centerSublabel}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="w-full grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/20">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color1 }}></span>
            <span>{label1}</span>
          </div>
          <span className="text-xs font-bold text-foreground mt-0.5">{val1}</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color2 }}></span>
            <span>{label2}</span>
          </div>
          <span className="text-xs font-bold text-foreground mt-0.5">{val2}</span>
        </div>
      </div>
    </div>
  )
}

export function GatewayProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<GatewayProfileTab>('stats')
  const [selectedQueue, setSelectedQueue] = useState<any | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // Test connection state
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  // Address-list client import states
  const [importingOpen, setImportingOpen] = useState(false)
  const [selectedListName, setSelectedListName] = useState('clientes')
  const [customListName, setCustomListName] = useState('')
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null)

  // Limpiar resultado de la importación cuando el modal se abre o se cierra
  useEffect(() => {
    if (!importingOpen) {
      setImportResult(null)
    }
  }, [importingOpen])

  // Consultar información del Router — se refresca automáticamente cada 15 s
  const anyModalOpen = editOpen || servicesOpen || importingOpen || confirmDeleteOpen || !!selectedQueue
  const { data: gateway, isLoading: isLoadingGateway, isError: isErrorGateway, refetch: refetchGateway } = useQuery({
    queryKey: ['gateway', id],
    queryFn: async () => {
      const { data } = await api.get(`/gateways/${id}`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 15_000,
  })

  // Ranking en vivo de clientes por consumo total
  const [liveClients, setLiveClients] = useState<any[]>([])
  const [bridgeBytes, setBridgeBytes] = useState<{ rx: number; tx: number } | null>(null)

  useEffect(() => {
    if (gateway?.settings_configured !== true) return

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
        } catch { }
      }
      return `${wsProtocol}//${wsHost}/api/traffic/ws/${id}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const clients = payload.clients || []
        const sortedClients = [...clients].sort((a: any, b: any) => (b.rx_rate + b.tx_rate) - (a.rx_rate + a.tx_rate))
        setLiveClients(sortedClients)
        const bridge = (payload.interfaces || []).find((i: any) => i.name === 'bridge1')
        if (bridge) setBridgeBytes({ rx: bridge.rx_bytes || 0, tx: bridge.tx_bytes || 0 })
      } catch (err) {
        console.error('Error al procesar mensaje de tráfico en vivo:', err)
      }
    }

    return () => {
      ws.close()
    }
  }, [id, gateway?.settings_configured])

  // Consultar todos los clientes del gateway (para estadísticas y mapa de cobertura)
  const { data: allClients = [], isLoading: isLoadingAllClients } = useQuery<Client[]>({
    queryKey: ['gateway-clients-all', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients`, {
        params: { gateway_id: id, limit: 1000 }
      })
      return data.items || []
    },
    enabled: gateway?.settings_configured === true,
  })

  // Consultar clientes asociados paginados (para la pestaña Clientes)
  const [clientsPage, setClientsPage] = useState(1)
  const clientsLimit = 10

  const { data: paginatedClientsData = { items: [], total: 0 }, isLoading: isLoadingPaginated } = useQuery({
    queryKey: ['gateway-clients-paginated', id, clientsPage, searchTerm],
    queryFn: async () => {
      const params: any = {
        gateway_id: id,
        skip: (clientsPage - 1) * clientsLimit,
        limit: clientsLimit
      }
      if (searchTerm.trim()) {
        params.search = searchTerm
      }
      const { data } = await api.get(`/clients`, { params })
      return data
    },
    enabled: gateway?.settings_configured === true,
  })

  // Query to get address list names from this gateway
  const { data: addressLists = [], isLoading: isLoadingLists } = useQuery<string[]>({
    queryKey: ['address-lists', id],
    queryFn: async () => {
      const { data } = await api.get(`/gateways/${id}/address-lists`)
      return data
    },
    enabled: importingOpen,
  })

  // Consultar colas asociadas
  const { data: queues = [], isLoading: isLoadingQueues, refetch: refetchQueues } = useQuery({
    queryKey: ['gateway-queues', id],
    queryFn: async () => {
      const { data } = await api.get(`/gateways/${id}/queues`)
      return data
    },
    enabled: gateway?.settings_configured === true,
  })

  // Consultar todos los planes disponibles (para cambiar plan en modal)
  const { data: plans = [] } = useQuery({
    queryKey: ['plans-all'],
    queryFn: async () => {
      const { data } = await api.get('/plans')
      return data
    },
    enabled: activeTab === 'queues',
  })

  // Mutación para activar/desactivar cola
  const toggleQueueMutation = useMutation({
    mutationFn: async ({ clientId, disabled }: { clientId: string; disabled: boolean }) => {
      await api.post(`/clients/${clientId}/toggle-queue`, null, {
        params: { disabled }
      })
    },
    onSuccess: () => {
      refetchQueues()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al cambiar estado de la cola'
      alert(msg)
    }
  })

  // Mutación para cambiar plan al vuelo
  const changePlanMutation = useMutation({
    mutationFn: async ({ clientId, planId }: { clientId: string; planId: string }) => {
      await api.post(`/clients/${clientId}/assign-plan`, null, {
        params: { plan_id: planId }
      })
    },
    onSuccess: () => {
      refetchQueues()
      setSelectedQueue(null)
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al cambiar plan en tiempo real'
      alert(msg)
    }
  })

  // Mutación para probar conexión
  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const { data } = await api.post(`/gateways/${id}/test-connection`)
      setTestResult(data)
      refetchGateway()
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || 'Error de red al conectar al gateway'
      setTestResult({ success: false, message: errMsg })
    } finally {
      setIsTesting(false)
    }
  }

  // Mutación para importar clientes de address-list
  const importMutation = useMutation({
    mutationFn: async (listName: string) => {
      const { data } = await api.post(`/gateways/${id}/import-clients`, null, {
        params: { list_name: listName }
      })
      return data
    },
    onSuccess: (data: any) => {
      setImportResult({
        success: true,
        message: `Importación exitosa. Se importaron ${data.imported_count} nuevos clientes.`
      })
      setSelectedListName('clientes')
      setCustomListName('')
      queryClient.invalidateQueries({ queryKey: ['gateway-clients-paginated', id] })
      queryClient.invalidateQueries({ queryKey: ['gateway-clients-all', id] })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al importar clientes desde el gateway.'
      setImportResult({
        success: false,
        message: msg
      })
    }
  })

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const listName = selectedListName === 'custom' ? customListName.trim() : selectedListName
    if (!listName) return
    importMutation.mutate(listName)
  }

  // Mutación para eliminar gateway
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/gateways/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routers'] })
      navigate('/gateways')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al eliminar el gateway'
      alert(msg)
    }
  })

  // Consultar sesiones PPPoE activas
  const { data: pppoeSessions = [], isLoading: isLoadingSessions, refetch: refetchSessions } = useQuery<any[]>({
    queryKey: ['gateway-pppoe-sessions', id],
    queryFn: async () => {
      const { data } = await api.get(`/gateways/${id}/pppoe-sessions`)
      return data
    },
    enabled: gateway?.settings_configured === true && activeTab === 'pppoe',
    refetchInterval: anyModalOpen ? false : activeTab === 'pppoe' ? 8000 : undefined,
  })

  // Mutación para desconectar sesión activa
  const disconnectSessionMutation = useMutation({
    mutationFn: async (username: string) => {
      await api.delete(`/gateways/${id}/pppoe-sessions/${username}`)
    },
    onSuccess: () => {
      refetchSessions()
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al desconectar la sesión'
      alert(msg)
    }
  })

  // Mutación para sincronizar perfiles PPPoE
  const syncProfilesMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/gateways/${id}/sync-pppoe-profiles`)
    },
    onSuccess: () => {
      refetchGateway()
      alert('Perfiles PPPoE sincronizados correctamente.')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al sincronizar perfiles PPPoE'
      alert(msg)
    }
  })

  // Config MikroTik API (para saber si debug está activo)
  const { data: mikrotikConfig } = useQuery<{ mikrotik_debug: boolean }>({
    queryKey: ['mikrotik-api-config'],
    queryFn: async () => {
      const { data } = await api.get('/settings/mikrotik-api')
      return data
    },
  })
  const debugEnabled = mikrotikConfig?.mikrotik_debug ?? false

  // Logs del sistema RouterOS (solo cuando debug activo y tab logs)
  const { data: logsData, isFetching: fetchingLogs, refetch: refetchLogs } = useQuery<{
    logs: Array<{ time?: string; topics?: string; message?: string }>
    total: number
  }>({
    queryKey: ['gateway-logs', id],
    queryFn: async () => {
      const { data } = await api.get(`/gateways/${id}/logs?limit=150`)
      return data
    },
    enabled: activeTab === 'logs' && debugEnabled,
    refetchInterval: anyModalOpen ? false : activeTab === 'logs' && debugEnabled ? 10000 : undefined,
  })

  // Historial ISP: audit logs filtrados por este gateway
  const { data: auditData, isFetching: fetchingAudit, refetch: refetchAudit } = useQuery<{
    items: Array<{
      id: string; action: string; user_name: string | null
      entity_name: string | null; detail: Record<string, unknown> | null
      ip_address: string | null; created_at: string
    }>
    total: number
  }>({
    queryKey: ['gateway-audit', id],
    queryFn: async () => {
      const { data } = await api.get('/audit-logs', {
        params: { entity_id: id, limit: 100 }
      })
      return data
    },
    enabled: activeTab === 'historial',
    refetchInterval: anyModalOpen ? false : activeTab === 'historial' ? 15_000 : undefined,
  })

  const AUDIT_META: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
    CREATE_GATEWAY:  { label: 'Gateway creado',       color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Server },
    UPDATE_GATEWAY:  { label: 'Configuración editada', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: Server },
    DELETE_GATEWAY:  { label: 'Gateway eliminado',    color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: Server },
    GATEWAY_ONLINE:  { label: 'Conectado',            color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Wifi },
    GATEWAY_OFFLINE: { label: 'Desconectado',         color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: WifiOff },
    IMPORT_CLIENTS:  { label: 'Importación clientes', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',   icon: Download },
    CREATE_CLIENT:   { label: 'Cliente creado',       color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserPlus },
    SUSPEND_CLIENT:  { label: 'Cliente suspendido',   color: 'text-orange-400 bg-orange-500/10 border-orange-500/20',   icon: UserX },
    ACTIVATE_CLIENT: { label: 'Cliente activado',     color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserCheck },
    ASSIGN_PLAN:     { label: 'Plan asignado',        color: 'text-brand-400 bg-brand-500/10 border-brand-500/20',      icon: Zap },
    TOGGLE_QUEUE:    { label: 'Cola modificada',      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: ToggleLeft },
  }

  // Función para sincronizar de manera completa todos los datos
  const handleSyncAll = () => {
    refetchGateway()
    refetchQueues()
    refetchSessions()
    queryClient.invalidateQueries({ queryKey: ['gateway', id] })
    queryClient.invalidateQueries({ queryKey: ['gateway-queues', id] })
    queryClient.invalidateQueries({ queryKey: ['gateway-pppoe-sessions', id] })
  }

  if (isLoadingGateway) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando perfil del gateway...</span>
        </div>
      </div>
    )
  }

  if (isErrorGateway || !gateway) {
    return (
      <div className="glass-card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Error al cargar el gateway</h3>
        <p className="text-muted-foreground text-sm mb-6">
          El gateway solicitado no existe o ha sido desactivado permanentemente.
        </p>
        <button onClick={() => navigate('/gateways')} className="btn-secondary mx-auto">
          <ArrowLeft className="w-4 h-4" />
          Volver a Routers
        </button>
      </div>
    )
  }

  // Calcular estadísticas usando la lista completa de clientes (allClients)
  const activeClients = allClients.filter((c: Client) => c.active).length
  const inactiveClients = allClients.length - activeClients
  const totalClients = allClients.length
  const activePercentage = totalClients > 0 ? (activeClients / totalClients) * 100 : 0

  const hasServiceConfig = gateway.settings_configured === true
  const usesPpp = gateway.security_mode === 'ppp_api' || gateway.security_mode === 'ppp_radius'
  const usesSimpleQueues = gateway.speed_control_type === 'simple_queues'
    || gateway.speed_control_type === 'dhcp_lease_dynamic'

  const gatewayTabs: Array<{
    id: GatewayProfileTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'stats', label: 'Estadísticas', icon: Network },
    { id: 'clients', label: 'Clientes Asociados', icon: Users },
    ...(usesSimpleQueues ? [{ id: 'queues' as const, label: 'Colas de Tráfico', icon: Activity }] : []),
    ...(usesPpp ? [{ id: 'pppoe' as const, label: 'Sesiones PPPoE', icon: Wifi }] : []),
    ...(debugEnabled ? [{ id: 'logs' as const, label: 'Logs ROS', icon: ScrollText }] : []),
    { id: 'historial', label: 'Historial ISP', icon: ClipboardList },
  ]
  const effectiveActiveTab = gatewayTabs.some((tab) => tab.id === activeTab) ? activeTab : 'stats'

  // Calcular ancho de banda dinámicamente desde las colas de MikroTik
  const activeQueues = queues.filter((q: any) => {
    if (q.disabled) return false
    const name = q.name?.toLowerCase() || ''

    // Filtrar dinámicamente la cola padre del gateway
    const gatewayParent = gateway?.parent_queue?.toLowerCase() || ''
    if (gatewayParent && name === gatewayParent) return false

    // Filtros legados
    if (name === 'isp_padre' || name === 'padre' || name === 'total') return false
    if (name.startsWith('isp_padre_')) return false
    return true
  })

  // Encontrar la cola padre del gateway en las colas traídas de MikroTik
  const gatewayParentName = gateway?.parent_queue?.toLowerCase() || ''
  const parentQueue = queues.find((q: any) => {
    const qName = q.name?.toLowerCase() || ''
    if (gatewayParentName && qName === gatewayParentName) return true
    if (!gatewayParentName && (qName === 'isp_padre' || qName === 'padre' || qName === 'total')) return true
    return false
  })

  // Extraer límites de velocidad del gateway (Prioridad: MikroTik parent queue max_limit > base de datos fallback)
  let configuredDownMbps = gateway?.bandwidth_down || 0
  let configuredUpMbps = gateway?.bandwidth_up || 0

  if (parentQueue && parentQueue.max_limit) {
    const [upMbps, downMbps] = parseMaxLimit(parentQueue.max_limit)
    configuredUpMbps = upMbps
    configuredDownMbps = downMbps
  }

  const totalUpMbps = activeQueues.reduce((acc: number, q: any) => {
    const [up] = parseMaxLimit(q.max_limit)
    return acc + up
  }, 0)

  const totalDownMbps = activeQueues.reduce((acc: number, q: any) => {
    const [, down] = parseMaxLimit(q.max_limit)
    return acc + down
  }, 0)

  const totalRxBytes = bridgeBytes?.rx ?? 0
  const totalTxBytes = bridgeBytes?.tx ?? 0
  const totalBytes = totalRxBytes + totalTxBytes
  const rxBytesPct = totalBytes > 0 ? (totalRxBytes / totalBytes) * 100 : 50

  const totalPages = Math.ceil((paginatedClientsData.total || 0) / clientsLimit)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Breadcrumb & Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/gateways')}
            className="w-10 h-10 rounded-lg bg-secondary/50 border border-border flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{gateway.name}</h1>
              <GatewayStatusBadge status={gateway.status ?? 'unknown'} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              ID: {gateway.id} {gateway.hw_model ? `· HW: ${gateway.hw_model}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                onClick={() => setServicesOpen(true)}
                className="btn-secondary"
              >
                <Settings2 className="w-4 h-4" />
                Ajustes
              </button>
              <button
                onClick={() => setEditOpen(true)}
                className="btn-primary"
              >
                <Edit2 className="w-4 h-4" />
                Editar
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Grid Principal ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Barra Lateral Izquierda - Detalles Rápidos */}
        <div className="space-y-6">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <Server className="w-4.5 h-4.5" />
              <span>Información de Conexión</span>
            </div>

            <div className="space-y-3">
              <div>
                <span className="block text-xs text-muted-foreground">Dirección IP / Host</span>
                <code className="text-sm font-mono text-foreground font-semibold">
                  {gateway.ip}:{gateway.api_port}
                </code>
              </div>

              <div>
                <span className="block text-xs text-muted-foreground">Usuario API</span>
                <span className="text-sm text-foreground font-medium">{gateway.api_username}</span>
              </div>

              {gateway.uptime && (
                <div>
                  <span className="block text-xs text-muted-foreground">Tiempo Activo (Uptime)</span>
                  <span className="text-sm text-foreground font-medium">{formatUptime(gateway.uptime)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Tarjeta de Localización */}
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <MapPin className="w-4.5 h-4.5" />
              <span>Coordenadas GPS</span>
            </div>
            {gateway.latitude && gateway.longitude ? (
              <div className="space-y-3 text-xs">

                {/* Mapa adaptado dentro de la tarjeta de coordenadas */}
                <div className="rounded-lg overflow-hidden h-[240px] border border-border/40 relative shadow-sm z-10">
                  <MapContainer
                    center={[gateway.latitude, gateway.longitude]}
                    zoom={13}
                    scrollWheelZoom={true}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* Marcador del Router */}
                    <Marker position={[gateway.latitude, gateway.longitude]} icon={gatewayIcon}>
                      <Popup>
                        <div className="p-1 text-foreground font-sans">
                          <h4 className="font-bold text-sm text-brand-400 flex items-center gap-1.5 m-0">
                            <Server className="w-3.5 h-3.5" />
                            {gateway.name}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1 mb-0 font-mono">{gateway.ip}</p>
                          <p className="text-[10px] text-muted-foreground m-0">Clientes: {allClients.length}</p>
                        </div>
                      </Popup>
                    </Marker>

                    {/* Marcadores de los clientes */}
                    {allClients
                      .filter((c: Client) => c.latitude && c.longitude)
                      .map((client: Client) => {
                        const color = client.active ? '%2310b981' : '%23f59e0b'
                        const clientSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="30" height="30">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                          </svg>
                        `)}`
                        const clientIcon = L.icon({
                          iconUrl: clientSvg,
                          iconSize: [26, 26],
                          iconAnchor: [13, 26],
                          popupAnchor: [0, -22],
                        })

                        return (
                          <Marker
                            key={client.id}
                            position={[client.latitude!, client.longitude!]}
                            icon={clientIcon}
                          >
                            <Popup>
                              <div className="p-1 space-y-1.5 text-foreground font-sans min-w-[140px]">
                                <h4 className="font-bold text-xs text-foreground m-0">{client.name}</h4>
                                <p className="text-[10px] text-muted-foreground m-0 font-mono">IP: {client.static_ip?.ip ?? 'PPPoE'}</p>
                                <div className="flex items-center justify-between border-t border-border/40 pt-1 mt-1">
                                  <span className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded-full ${client.active
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                                    }`}>
                                    {client.active ? 'activo' : 'suspendido'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/clients/${client.id}`)}
                                    className="text-[9px] uppercase font-bold text-brand-400 hover:underline"
                                  >
                                    Ver Perfil
                                  </button>
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        )
                      })}
                  </MapContainer>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Latitud:</span>
                    <span className="font-mono text-foreground font-semibold">{gateway.latitude}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Longitud:</span>
                    <span className="font-mono text-foreground font-semibold">{gateway.longitude}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-muted-foreground">Sin ubicación geográfica registrada.</p>
                {isAdmin && (
                  <button
                    onClick={() => setEditOpen(true)}
                    className="text-xs text-brand-400 hover:text-brand-300 font-bold mt-2 hover:underline transition-all"
                  >
                    Marcar ubicación en el mapa
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Panel Principal - Tabs a la Derecha */}
        <div className="lg:col-span-2 space-y-6">
          {!hasServiceConfig ? (
            <div className="glass-card flex min-h-[400px] flex-col items-center justify-center p-12 text-center">
              <Settings2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <h3 className="mb-1 text-sm font-semibold text-foreground">
                Configura los ajustes operativos del gateway
              </h3>
              <p className="mb-4 max-w-md text-xs leading-relaxed text-muted-foreground">
                Configura los ajustes operativos del gateway para optimizar su rendimiento y seguridad.
              </p>
              {isAdmin ? (
                <button type="button" onClick={() => setServicesOpen(true)} className="btn-primary text-sm">
                  <Settings2 className="h-4 w-4" />
                  Realizar ajustes
                </button>
              ) : (
                <p className="text-xs text-amber-400">Un administrador debe completar esta configuración.</p>
              )}
            </div>
          ) : (
          <>
          {/* Resumen de la configuración operativa aplicada al gateway */}
          <div className={`glass-card border p-4 ${hasServiceConfig ? 'border-border/40' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Seguridad',
                    value: SECURITY_MODE_LABELS[gateway.security_mode] ?? 'Pendiente',
                    icon: Settings2,
                  },
                  {
                    label: 'Registro de tráfico',
                    value: TRAFFIC_ACCOUNTING_LABELS[gateway.traffic_accounting] ?? 'Pendiente',
                    icon: Network,
                  },
                  {
                    label: 'Control de velocidad',
                    value: SPEED_CONTROL_LABELS[gateway.speed_control_type] ?? 'Pendiente',
                    icon: Sliders,
                  },
                ].map((setting) => {
                  const Icon = setting.icon
                  return (
                    <div key={setting.label} className="flex min-w-0 items-center gap-2.5">
                      <div className="rounded-lg bg-brand-500/10 p-2 text-brand-400">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {setting.label}
                        </span>
                        <span className="block truncate text-xs font-semibold text-foreground" title={setting.value}>
                          {setting.value}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {isAdmin && (
                <button type="button" onClick={() => setServicesOpen(true)} className="btn-secondary shrink-0 text-xs">
                  <Settings2 className="h-3.5 w-3.5" />
                  {hasServiceConfig ? 'Modificar ajustes' : 'Completar ajustes'}
                </button>
              )}
            </div>
            {!hasServiceConfig && (
              <p className="mt-3 border-t border-amber-500/20 pt-3 text-xs text-amber-400">
                Completa los ajustes operativos. Los clientes y el historial siguen disponibles mientras tanto.
              </p>
            )}
          </div>

          {/* Navegación de Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Secciones del gateway">
            {gatewayTabs.map((tab) => {
              const Icon = tab.icon
              const isActive = effectiveActiveTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-all ${isActive
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Pestaña: Estadísticas */}
          {effectiveActiveTab === 'stats' && (
            <div className="space-y-6">
              {/* Doughnut charts grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <DonutChart
                  percentage={activePercentage}
                  title="Distribución de Clientes"
                  label1="Activos"
                  val1={activeClients}
                  color1="#10b981"
                  label2="Suspendidos"
                  val2={inactiveClients}
                  color2="#f59e0b"
                  centerLabel={`${Math.round(activePercentage)}%`}
                  centerSublabel="Activos"
                />

                <DonutChart
                  percentage={rxBytesPct}
                  title="Tráfico Total"
                  label1="Descargado"
                  val1={formatBytes(totalRxBytes)}
                  color1="#3b82f6"
                  label2="Subido"
                  val2={formatBytes(totalTxBytes)}
                  color2="#a835f7"
                  centerLabel={formatBytes(totalBytes)}
                  centerSublabel="Total"
                />
              </div>

              {/* Ancho de Banda Asignado summaries */}
              {usesSimpleQueues ? (
                <div className="glass-card p-5 border border-border/40 space-y-4 font-sans">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/40 pb-2.5 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-brand-400" />
                  Distribución de Ancho de Banda Asignado
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-secondary/20 p-4 rounded-lg border border-border/20">
                    <span className="block text-xs text-muted-foreground">Velocidad Descarga Asignada</span>
                    {isLoadingQueues ? (
                      <div className="flex items-center gap-1.5 mt-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span className="text-xs text-muted-foreground">Calculando...</span>
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-blue-400 mt-1 block">
                        {formatBandwidth(totalDownMbps)}
                        {configuredDownMbps ? (
                          <span className="text-[10px] text-muted-foreground block font-normal mt-0.5">
                            de {configuredDownMbps} Mbps totales ({((totalDownMbps / configuredDownMbps) * 100).toFixed(0)}%)
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground block font-normal mt-0.5">Límite gateway: Ilimitado</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="bg-secondary/20 p-4 rounded-lg border border-border/20">
                    <span className="block text-xs text-muted-foreground">Velocidad Subida Asignada</span>
                    {isLoadingQueues ? (
                      <div className="flex items-center gap-1.5 mt-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        <span className="text-xs text-muted-foreground">Calculando...</span>
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-purple-400 mt-1 block">
                        {formatBandwidth(totalUpMbps)}
                        {configuredUpMbps ? (
                          <span className="text-[10px] text-muted-foreground block font-normal mt-0.5">
                            de {configuredUpMbps} Mbps totales ({((totalUpMbps / configuredUpMbps) * 100).toFixed(0)}%)
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground block font-normal mt-0.5">Límite gateway: Ilimitado</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="bg-secondary/20 p-4 rounded-lg border border-border/20">
                    <span className="block text-xs text-muted-foreground">Capacidad Límite del Router</span>
                    {isLoadingGateway || isLoadingQueues ? (
                      <div className="flex items-center gap-1.5 mt-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                        <span className="text-xs text-muted-foreground">Cargando...</span>
                      </div>
                    ) : (
                      <span className="text-lg font-bold text-brand-400 mt-1 block">
                        {configuredDownMbps || configuredUpMbps ? (
                          <>
                            ↓ {configuredDownMbps} / ↑ {configuredUpMbps} <span className="text-xs font-semibold text-muted-foreground">Mbps</span>
                          </>
                        ) : (
                          'Ilimitado (0/0)'
                        )}
                        <span className="text-[10px] text-muted-foreground block font-normal mt-0.5">
                          Cola: <strong>{parentQueue?.name || gateway?.parent_queue || 'sin cola'}</strong>
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/20 flex flex-wrap justify-between gap-2">
                  <span>Ancho de banda promedio por cliente activo: <strong>{activeClients > 0 ? formatBandwidth((totalDownMbps + totalUpMbps) / activeClients) : '0 MB'}</strong></span>
                  <span>
                    {configuredDownMbps && configuredUpMbps
                      ? `Asignación de capacidad: ↓ ${((totalDownMbps / configuredDownMbps) * 100).toFixed(0)}% / ↑ ${((totalUpMbps / configuredUpMbps) * 100).toFixed(0)}% respecto al límite del Router.`
                      : 'Capacidad de carga calculada sobre las colas de tráfico activas en MikroTik.'}
                  </span>
                </div>
                </div>
              ) : (
                <div className="glass-card flex items-start gap-3 border border-border/40 p-5">
                  <div className="rounded-lg bg-brand-500/10 p-2 text-brand-400">
                    <Sliders className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {gateway.speed_control_type === 'pcq_addresslist'
                        ? 'Control de velocidad mediante PCQ'
                        : 'Control de velocidad desactivado'}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {gateway.speed_control_type === 'pcq_addresslist'
                        ? 'La distribución se administra con Queue Tree y Address Lists; por eso no se muestra el resumen de colas simples.'
                        : 'Las estadísticas de clientes y tráfico continúan disponibles, pero este gateway no aplica límites de velocidad desde el NMS.'}
                    </p>
                    {isAdmin && (
                      <button type="button" onClick={() => setServicesOpen(true)} className="mt-3 text-xs font-semibold text-brand-400 hover:text-brand-300">
                        Cambiar control de velocidad
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Top 10 Clientes Activos por Consumo */}
              <div className="glass-card p-5 border border-border/40 space-y-4 font-sans">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/40 pb-2.5 flex items-center gap-2">
                  <Users className="w-4 h-4 text-brand-400" />
                  Top 10 Clientes Activos
                </h3>

                {liveClients.length === 0 ? (
                  <p className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                    Cargando ranking de consumo en vivo...
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Tasa Descarga (RX)</th>
                          <th>Tasa Subida (TX)</th>
                          <th>Consumo Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveClients.slice(0, 10).map((lc: any) => (
                          <tr
                            key={lc.client_id}
                            onClick={() => navigate(`/clients/${lc.client_id}`)}
                            className="hover:bg-secondary/40 cursor-pointer transition-colors"
                          >
                            <td className="font-semibold text-sm text-foreground">
                              {lc.name}
                            </td>
                            <td className="font-mono text-xs text-cyan-400 font-bold">
                              {formatSpeed(lc.rx_rate)}
                            </td>
                            <td className="font-mono text-xs text-violet-400 font-bold">
                              {formatSpeed(lc.tx_rate)}
                            </td>
                            <td className="font-mono text-xs text-muted-foreground">
                              {(() => {
                                const bytes = lc.rx_bytes + lc.tx_bytes
                                const mb = bytes / (1024 * 1024)
                                if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(2)} TB`
                                if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
                                return `${mb.toFixed(1)} MB`
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Pestaña: Clientes */}
          {effectiveActiveTab === 'clients' && (
            <div className="space-y-4">
              {/* Barra de Búsqueda y Acciones */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-grow max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setClientsPage(1) }}
                    placeholder="Buscar cliente por name, cédula o IP..."
                    className="input-field pl-10"
                  />
                </div>
                {isAdmin && (
                  <div>
                    {gateway.status === 'online' ? (
                      <button
                        onClick={() => setImportingOpen(true)}
                        className="btn-secondary text-brand-400 hover:text-brand-300 text-xs py-2 px-3 flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Importar desde Address-list
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground bg-secondary/40 py-2 px-3 rounded-lg border border-border/20" title="El gateway debe estar En línea para permitir la importación automática de clientes.">
                        Router fuera de línea (sin importación)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {paginatedClientsData.items.length === 0 ? (
                <div className="glass-card p-8 text-center text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
                  No se encontraron clientes asignados a este gateway que coincidan con la búsqueda.
                </div>
              ) : (
                <>
                  <div className="glass-card overflow-hidden">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th className="hidden sm:table-cell">Cédula</th>
                          <th>IP</th>
                          <th>Plan</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedClientsData.items.map((client: Client) => (
                          <tr
                            key={client.id}
                            onClick={() => navigate(`/clients/${client.id}`)}
                            className="hover:bg-secondary/40 cursor-pointer transition-colors"
                          >
                            <td>
                              <div className="font-semibold text-sm text-foreground">{client.name}</div>
                              <div className="text-xs text-muted-foreground capitalize sm:hidden">
                                {client.connection_type === 'static' ? 'IP Estática' : 'PPPoE'}
                              </div>
                            </td>
                            <td className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                              {client.cedula}
                            </td>
                            <td>
                              <code className="text-xs font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                                {client.static_ip?.ip ? client.static_ip.ip : 'PPPoE'}
                              </code>
                            </td>
                            <td className="text-xs text-brand-400 font-medium">
                              {client.plan_activo?.name ? client.plan_activo.name : 'Sin plan'}
                            </td>
                            <td>
                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${client.active
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}>
                                {client.active ? 'Activo' : 'Suspendido'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Controles de Paginación */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between p-1 mt-4">
                      <span className="text-xs text-muted-foreground">
                        Mostrando {paginatedClientsData.items.length} de {paginatedClientsData.total} clientes
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setClientsPage((prev) => Math.max(prev - 1, 1))}
                          disabled={clientsPage === 1}
                          className="btn-secondary py-1.5 px-3 text-xs"
                        >
                          Anterior
                        </button>
                        <span className="text-xs text-foreground font-medium font-mono px-2">
                          Página {clientsPage} de {totalPages}
                        </span>
                        <button
                          onClick={() => setClientsPage((prev) => Math.min(prev + 1, totalPages))}
                          disabled={clientsPage === totalPages}
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

          {/* Pestaña: Colas de Tráfico */}
          {effectiveActiveTab === 'queues' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-secondary/15 p-4 rounded-xl border border-border/40">
                <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
                  Listado de colas simples (Simple Queues) activas en el MikroTik. Las colas enlazadas a clientes locales permiten interactuar directamente para activar, desactivar o modificar sus límites de velocidad.
                </p>
                <button
                  onClick={() => refetchQueues()}
                  disabled={isLoadingQueues}
                  className="btn-secondary text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingQueues ? 'animate-spin' : ''}`} />
                  Actualizar
                </button>
              </div>

              {isLoadingQueues ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
                    <span>Cargando colas de tráfico desde MikroTik...</span>
                  </div>
                </div>
              ) : queues.length === 0 ? (
                <div className="glass-card p-8 text-center text-muted-foreground">
                  <Sliders className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
                  No se encontraron colas simples configuradas en este gateway.
                </div>
              ) : (
                <div className="glass-card overflow-hidden font-sans">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Cola / Cliente</th>
                        <th>IP (Target)</th>
                        <th> Upload / Download</th>
                        <th>Tráfico actual (TX / RX)</th>
                        <th>Estado</th>
                        {isAdmin && <th className="text-right">Acciones</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {queues.map((q: any) => (
                        <tr key={q.id} className="hover:bg-secondary/40 transition-colors">
                          <td>
                            {q.client_id ? (
                              <div
                                onClick={() => navigate(`/clients/${q.client_id}`)}
                                className="font-semibold text-sm text-brand-400 hover:underline cursor-pointer"
                              >
                                {q.name}
                              </div>
                            ) : (
                              <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                {q.name}
                                <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.2 rounded-full uppercase font-bold">Huérfana</span>
                              </div>
                            )}
                          </td>
                          <td>
                            <code className="text-xs font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                              {q.target}
                            </code>
                          </td>
                          <td className="text-xs font-mono font-medium text-foreground">
                            {formatQueueLimit(q.max_limit)}
                          </td>
                          <td className="text-xs font-mono text-brand-400 font-semibold">
                            {q.rate_human}
                          </td>
                          <td>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${!q.disabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-destructive/10 text-destructive border border-destructive/20'
                              }`}>
                              {!q.disabled ? 'Activo' : 'Suspendido'}
                            </span>
                          </td>
                          {isAdmin && (
                            <td className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {q.client_id && (
                                  <>
                                    <button
                                      onClick={() => {
                                        setSelectedQueue(q)
                                        setSelectedPlanId(q.plan_activo?.id || '')
                                      }}
                                      className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1 hover:text-brand-400"
                                      title="Cambiar velocidad/plan al vuelo"
                                    >
                                      <Sliders className="w-3 h-3" />
                                      Cambiar Plan
                                    </button>
                                    <button
                                      onClick={() => toggleQueueMutation.mutate({
                                        clientId: q.client_id,
                                        disabled: !q.disabled
                                      })}
                                      disabled={toggleQueueMutation.isPending}
                                      className={`btn-secondary py-1 px-2.5 text-xs ${!q.disabled ? 'text-destructive hover:bg-destructive/10' : 'text-emerald-400 hover:bg-emerald-500/10'}`}
                                      title={!q.disabled ? 'Deshabilitar cola' : 'Habilitar cola'}
                                    >
                                      {!q.disabled ? 'Suspender' : 'Activar'}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Pestaña: Sesiones PPPoE Activas */}
          {effectiveActiveTab === 'pppoe' && (
            <div className="space-y-6 font-sans animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Sesiones PPPoE en tiempo real</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Monitoreo de clientes conectados por túnel PPPoE en este gateway.
                  </p>
                </div>
                
                {isAdmin && (
                  <button
                    onClick={() => {
                      if (confirm('¿Deseas sincronizar los perfiles PPPoE desde el gateway MikroTik?')) {
                        syncProfilesMutation.mutate()
                      }
                    }}
                    disabled={syncProfilesMutation.isPending}
                    className="btn-secondary text-xs h-auto py-1.5"
                  >
                    {syncProfilesMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Sincronizar Perfiles
                  </button>
                )}
              </div>

              {gateway.status !== 'online' ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-xs text-amber-500 font-sans flex items-start gap-2.5">
                  <AlertCircle className="w-4.5 h-4.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <span>El gateway se encuentra fuera de línea. No se pueden recuperar las sesiones PPPoE activas en este momento.</span>
                </div>
              ) : isLoadingSessions ? (
                <div className="text-center py-12 text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <span>Cargando sesiones PPPoE activas...</span>
                </div>
              ) : pppoeSessions.length === 0 ? (
                <div className="glass-card p-8 text-center text-muted-foreground font-sans border border-border/40">
                  No hay sesiones PPPoE activas en este momento.
                </div>
              ) : (
                <div className="overflow-x-auto border border-border/40 rounded-lg">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Usuario</th>
                        <th>Dirección IP</th>
                        <th>Uptime / Tiempo Conectado</th>
                        <th>Dirección MAC</th>
                        <th>Tráfico (Descarga ↓ / Subida ↑)</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pppoeSessions.map((session) => (
                        <tr key={session.id || session.username}>
                          <td className="font-semibold text-foreground text-sm font-mono">{session.username}</td>
                          <td className="font-mono text-xs">{session.ip_address || '—'}</td>
                          <td className="text-xs text-muted-foreground font-mono">{session.uptime || '—'}</td>
                          <td className="text-xs text-muted-foreground font-mono">{session.caller_id || '—'}</td>
                          <td className="text-xs font-mono">
                            <span className="text-emerald-400 font-semibold block">↓ {session.bytes_rx_human || '0 B'}</span>
                            <span className="text-blue-400 font-semibold block">↑ {session.bytes_tx_human || '0 B'}</span>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`¿Estás seguro de que deseas expulsar (kick) al usuario ${session.username}?`)) {
                                  disconnectSessionMutation.mutate(session.username)
                                }
                              }}
                              disabled={disconnectSessionMutation.isPending}
                              className="text-xs font-bold px-2.5 py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 active:scale-[0.98] transition-all"
                            >
                              Kick
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Pestaña: Logs RouterOS */}
          {effectiveActiveTab === 'logs' && debugEnabled && (
            <div className="space-y-4 animate-fade-in">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-foreground">
                    Log del sistema RouterOS
                  </span>
                  {logsData && (
                    <span className="text-xs text-muted-foreground">
                      — mostrando últimas {logsData.logs.length} de {logsData.total} entradas
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => refetchLogs()}
                  disabled={fetchingLogs}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  {fetchingLogs
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Actualizar
                </button>
              </div>

              {/* Tabla de logs */}
              {fetchingLogs && !logsData ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Obteniendo logs del gateway...</span>
                </div>
              ) : logsData && logsData.logs.length > 0 ? (
                <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
                  <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-secondary/60 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <th className="px-4 py-3 w-36">Hora</th>
                          <th className="px-4 py-3 w-40">Categoría</th>
                          <th className="px-4 py-3">Mensaje</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30 font-mono text-xs">
                        {[...logsData.logs].reverse().map((entry, i) => {
                          const topics = entry.topics ?? ''
                          const rowColor = topics.includes('error')
                            ? 'text-red-400 bg-red-500/5'
                            : topics.includes('warning')
                            ? 'text-amber-400 bg-amber-500/5'
                            : topics.includes('debug')
                            ? 'text-blue-400'
                            : 'text-foreground/80'
                          return (
                            <tr key={i} className={`hover:bg-secondary/20 transition-colors ${rowColor}`}>
                              <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                                {entry.time ?? '—'}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap">
                                <span className="px-1.5 py-0.5 rounded bg-secondary/50 text-[10px] font-semibold">
                                  {topics || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-2 break-all">{entry.message ?? ''}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
                  <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No hay entradas de log disponibles.</p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Se actualiza automáticamente cada 10 segundos · Debug activo en Ajustes → MikroTik API
              </p>
            </div>
          )}

          {/* Pestaña: Historial ISP */}
          {effectiveActiveTab === 'historial' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-foreground">Historial de eventos ISP</span>
                  {auditData && (
                    <span className="text-xs text-muted-foreground">
                      — {auditData.total} eventos
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => refetchAudit()}
                  disabled={fetchingAudit}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  {fetchingAudit
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Actualizar
                </button>
              </div>

              {fetchingAudit && !auditData ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Cargando historial...</span>
                </div>
              ) : auditData && auditData.items.length > 0 ? (
                <div className="glass-card overflow-hidden">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Fecha / Hora</th>
                        <th>Evento</th>
                        <th>Detalle</th>
                        <th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditData.items.map((entry) => {
                        const meta = AUDIT_META[entry.action] ?? {
                          label: entry.action,
                          color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
                          icon: ClipboardList,
                        }
                        const Icon = meta.icon
                        const detail = entry.detail
                        const detailText = detail
                          ? Object.entries(detail)
                              .filter(([k]) => k !== 'source')
                              .map(([k, v]) => {
                                if (k === 'reason') return `Motivo: ${v}`
                                if (k === 'plan_name') return `Plan: ${v}`
                                if (k === 'imported_count') return `${v} importados`
                                if (k === 'disabled') return v ? 'Deshabilitada' : 'Habilitada'
                                if (k === 'ip') return `IP: ${v}`
                                return null
                              })
                              .filter(Boolean)
                              .join(' · ')
                          : ''
                        return (
                          <tr key={entry.id} className="hover:bg-secondary/30 transition-colors">
                            <td className="whitespace-nowrap">
                              <span className="text-xs font-mono text-muted-foreground">
                                {new Date(entry.created_at).toLocaleString('es-EC', {
                                  day: '2-digit', month: '2-digit', year: '2-digit',
                                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                                })}
                              </span>
                            </td>
                            <td>
                              <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${meta.color}`}>
                                <Icon className="w-3 h-3" />
                                {meta.label}
                              </span>
                            </td>
                            <td>
                              <span className="text-xs text-muted-foreground">
                                {detailText || '—'}
                              </span>
                            </td>
                            <td>
                              <span className="text-xs text-foreground font-medium">
                                {entry.user_name ?? (
                                  <span className="text-muted-foreground italic">Sistema</span>
                                )}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
                  <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No hay eventos registrados para este gateway.</p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Se actualiza automáticamente cada 15 segundos
              </p>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* ── Dialog Seguridad, Tráfico y Velocidad ── */}
      {servicesOpen && (
        <GatewayServicesDialog
          open={servicesOpen}
          onClose={() => setServicesOpen(false)}
          gateway={gateway}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['gateway', id] })
            queryClient.invalidateQueries({ queryKey: ['gateway-queues', id] })
            setActiveTab('stats')
          }}
        />
      )}

      {/* ── Dialog Crear/Editar Router ── */}
      {editOpen && (
        <GatewayFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          gateway={gateway}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['gateway', id] })
            queryClient.invalidateQueries({ queryKey: ['gateways'] })
            queryClient.invalidateQueries({ queryKey: ['gateway-queues', id] })
            setEditOpen(false)
          }}
          onDelete={() => {
            setEditOpen(false)
            setConfirmDeleteOpen(true)
          }}
        />
      )}

      {/* ── Modal Confirmación de Eliminación ── */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar gateway?</h3>
            <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
              Esta acción desactivará el gateway <strong>{gateway.name}</strong>. Los clientes asignados no se borrarán pero perderán el enlace a este gateway.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Importar Clientes de Address-list ── */}
      {importingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md mx-4 animate-fade-in border border-border/50">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Download className="w-5 h-5 text-brand-400" />
                Importar desde Address-list
              </h2>
              <button
                type="button"
                onClick={() => setImportingOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {importResult?.success ? (
              <div className="p-6 text-center space-y-4 font-sans">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto text-emerald-400 animate-fade-in">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-semibold text-foreground">¡Importación Exitosa!</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-sans">
                    {importResult.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportingOpen(false)}
                  className="btn-primary w-full justify-center mt-2"
                >
                  Entendido
                </button>
              </div>
            ) : (
              <form onSubmit={handleImportSubmit} className="p-5 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Selecciona una lista de direcciones del gateway <strong>{gateway.name}</strong>. Se importarán todas sus IPs y se registrarán como nuevos clientes en el sistema y en la lista <strong>clientes</strong> de MikroTik.
                </p>

                {importResult && !importResult.success && (
                  <div className="rounded-lg p-3.5 flex items-start gap-3 text-xs leading-relaxed bg-destructive/10 border border-destructive/30 text-destructive font-sans">
                    <XCircle className="w-4.5 h-4.5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-grow">
                      <p className="font-semibold text-foreground">Fallo en la importación</p>
                      <p className="mt-0.5 text-muted-foreground">{importResult.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setImportResult(null)}
                      className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

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
                      <option value="clientes">clientes</option>
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
                    onClick={() => setImportingOpen(false)}
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
            )}
          </div>
        </div>
      )}

      {/* ── Modal Cambiar Plan en Tiempo Real ── */}
      {selectedQueue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md mx-4 animate-fade-in border border-border/50">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Sliders className="w-5 h-5 text-brand-400" />
                Cambiar Plan en Caliente
              </h2>
              <button
                type="button"
                onClick={() => setSelectedQueue(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 font-sans">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Estás cambiando el plan del cliente <strong>{selectedQueue.client_name}</strong> con IP <strong>{selectedQueue.target}</strong>. El límite de velocidad de MikroTik se modificará inmediatamente.
              </p>

              <div>
                <span className="block text-xs text-muted-foreground">Plan Actual</span>
                <span className="text-sm font-semibold text-foreground block">{selectedQueue.plan_activo?.name || 'Ninguno'}</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5 font-sans">
                  Seleccionar Nuevo Plan *
                </label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="input-field cursor-pointer"
                >
                  <option value="">-- Seleccionar Plan --</option>
                  {plans.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - ${p.price}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedQueue(null)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (!selectedPlanId) return
                    changePlanMutation.mutate({
                      clientId: selectedQueue.client_id,
                      planId: selectedPlanId
                    })
                  }}
                  disabled={changePlanMutation.isPending || !selectedPlanId}
                  className="btn-primary flex-1 justify-center"
                >
                  {changePlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {changePlanMutation.isPending ? 'Cambiando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
