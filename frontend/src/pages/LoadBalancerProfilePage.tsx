/**
 * LoadBalancerProfilePage — Ficha del balanceador: conexión y ubicación,
 * configuración de balanceo (PCC/Failover), scripts, puertos y tráfico en
 * vivo, historial de ejecuciones.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Shuffle, Edit2, Trash2, MapPin, Key, Network, Loader2,
  CheckCircle2, XCircle, Plus, X, Terminal, Activity, ClipboardList,
  RefreshCw, AlertCircle, Wifi, WifiOff, History, Server, Pencil,
} from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { LoadBalancerFormDialog } from '@/components/LoadBalancerFormDialog'
import { WanLinkFormDialog, type WanLink } from '@/components/WanLinkFormDialog'
import { RouterStatusBadge } from '@/components/RouterStatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { formatDateTime, formatUptime, saveButtonClass } from '@/lib/utils'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import TrafficChart, { formatSpeed } from '@/components/TrafficChart'

const markerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23f59e0b" width="38" height="38">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const lbIcon = L.icon({
  iconUrl: markerSvg,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -32],
})

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(2)} TB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

interface LoadBalancer {
  id: string
  name: string
  ip: string
  api_port: number
  api_username: string
  hw_model: string | null
  notes: string | null
  latitude: number | null
  longitude: number | null
  site_id?: string | null
  site_name?: string | null
  zerotier_node_id?: string | null
  algorithm: 'pcc' | 'failover'
  wan_links: WanLink[] | null
  last_script_source: string | null
  last_script_applied_at: string | null
  last_script_status: string | null
  status?: 'online' | 'offline' | 'tunnel_down' | 'unknown' | null
  uptime?: string | null
  ros_version?: string | null
}

interface LbInterface {
  name: string
  running: boolean
  disabled: boolean
  rx_bytes: number
  tx_bytes: number
  rx_rate: number
  tx_rate: number
}

interface ScriptRun {
  id: string
  origin: 'template' | 'custom'
  algorithm: string | null
  source: string
  success: boolean
  output: string | null
  executed_by_name: string | null
  created_at: string
}

interface ApplyResult {
  success: boolean
  message: string
  source: string
  output?: string | null
}

type LbProfileTab = 'info' | 'balanceo' | 'script' | 'puertos' | 'trafico' | 'historial'

function PortStatusBadge({ running, disabled }: { running: boolean; disabled: boolean }) {
  if (disabled) {
    return (
      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
        Deshabilitada
      </span>
    )
  }
  if (running) {
    return (
      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit">
        <Wifi className="w-3 h-3" /> Activa
      </span>
    )
  }
  return (
    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1 w-fit">
      <WifiOff className="w-3 h-3" /> Caída
    </span>
  )
}

export function LoadBalancerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  const [activeTab, setActiveTab] = useState<LbProfileTab>('info')
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<ScriptRun | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null)

  const anyModalOpen = editOpen || confirmDeleteOpen || !!selectedRun || linkModalOpen

  const { data: lb, isLoading: isLoadingLb, isError: isErrorLb } = useQuery<LoadBalancer>({
    queryKey: ['load-balancer', id],
    queryFn: async () => {
      const { data } = await api.get(`/load-balancers/${id}`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 15_000,
  })

  const { data: interfaces = [] } = useQuery<LbInterface[]>({
    queryKey: ['load-balancer-interfaces', id],
    queryFn: async () => {
      const { data } = await api.get(`/load-balancers/${id}/interfaces`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 5_000,
  })

  const { data: scriptRuns = [] } = useQuery<ScriptRun[]>({
    queryKey: ['load-balancer-script-runs', id],
    queryFn: async () => {
      const { data } = await api.get(`/load-balancers/${id}/script-runs`)
      return data
    },
    enabled: activeTab === 'historial',
    refetchInterval: anyModalOpen ? false : activeTab === 'historial' ? 15_000 : undefined,
  })

  // ── Configuración de balanceo (editable localmente, se sincroniza una vez al cargar) ──
  const [algorithm, setAlgorithm] = useState<'pcc' | 'failover'>('pcc')
  const [wanLinks, setWanLinks] = useState<WanLink[]>([])
  const [balancingLoaded, setBalancingLoaded] = useState(false)
  // true cuando la configuración guardada tiene cambios que todavía no se aplicaron en el equipo.
  const [pendingApply, setPendingApply] = useState(false)

  useEffect(() => {
    if (lb && !balancingLoaded) {
      setAlgorithm(lb.algorithm || 'pcc')
      setWanLinks(lb.wan_links ?? [])
      setPendingApply(lb.last_script_status !== 'success')
      setBalancingLoaded(true)
    }
  }, [lb, balancingLoaded])

  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)

  const saveBalancingMutation = useMutation({
    mutationFn: async (payload: { algorithm: 'pcc' | 'failover'; wan_links: WanLink[] }) => {
      const { data } = await api.put(`/load-balancers/${id}/balancing`, payload)
      return data
    },
    onSuccess: (data) => {
      setAlgorithm(data.algorithm)
      setWanLinks(data.wan_links ?? [])
      setPendingApply(true)
      queryClient.invalidateQueries({ queryKey: ['load-balancer', id] })
    },
  })

  const applyTemplateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/load-balancers/${id}/apply-template`)
      return data as ApplyResult
    },
    onSuccess: (data) => {
      setApplyResult(data)
      if (data.success) setPendingApply(false)
      queryClient.invalidateQueries({ queryKey: ['load-balancer', id] })
      queryClient.invalidateQueries({ queryKey: ['load-balancer-script-runs', id] })
    },
    onError: (err: any) => {
      setApplyResult({
        success: false,
        message: err?.response?.data?.detail || 'Error al aplicar la plantilla en el balanceador',
        source: '',
      })
    },
  })

  const handleAlgorithmChange = (next: 'pcc' | 'failover') => {
    if (next === algorithm) return
    setApplyResult(null)
    saveBalancingMutation.mutate({ algorithm: next, wan_links: wanLinks })
  }

  const handleRemoveLink = (index: number) => {
    if (!confirm('¿Quitar este enlace WAN de la configuración?')) return
    setApplyResult(null)
    saveBalancingMutation.mutate({ algorithm, wan_links: wanLinks.filter((_, i) => i !== index) })
  }

  const openAddLinkModal = () => { setEditingLinkIndex(null); setLinkModalOpen(true) }
  const openEditLinkModal = (index: number) => { setEditingLinkIndex(index); setLinkModalOpen(true) }

  const handleLinkModalSave = (link: WanLink) => {
    setApplyResult(null)
    const nextLinks = editingLinkIndex !== null
      ? wanLinks.map((l, i) => (i === editingLinkIndex ? link : l))
      : [...wanLinks, link]
    saveBalancingMutation.mutate(
      { algorithm, wan_links: nextLinks },
      { onSuccess: () => { setLinkModalOpen(false); setEditingLinkIndex(null) } }
    )
  }

  const handleApplyTemplate = () => {
    if (wanLinks.length < 2) return
    if (!confirm('Esto aplicará reglas de firewall y rutas reales en el balanceador. ¿Continuar?')) return
    setApplyResult(null)
    applyTemplateMutation.mutate()
  }

  // ── Tráfico en vivo (WebSocket, solo mientras la pestaña está activa) ──
  const [selectedChartInterface, setSelectedChartInterface] = useState('__all__')
  const [liveTick, setLiveTick] = useState<{ timestamp: string; interfaces: LbInterface[] } | null>(null)
  const [liveSeries, setLiveSeries] = useState<{ timestamp: string; rx_rate: number; tx_rate: number }[]>([])

  useEffect(() => {
    if (activeTab !== 'trafico' || !id) return

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
      return `${wsProtocol}//${wsHost}/api/load-balancers/ws/${id}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        setLiveTick({ timestamp: payload.timestamp, interfaces: payload.interfaces || [] })
      } catch (err) {
        console.error('Error al procesar tráfico en vivo del balanceador:', err)
      }
    }
    return () => ws.close()
  }, [activeTab, id])

  useEffect(() => { setLiveSeries([]) }, [selectedChartInterface])

  useEffect(() => {
    if (!liveTick) return
    let rx = 0
    let tx = 0
    if (selectedChartInterface === '__all__') {
      rx = liveTick.interfaces.reduce((acc, i) => acc + i.rx_rate, 0)
      tx = liveTick.interfaces.reduce((acc, i) => acc + i.tx_rate, 0)
    } else {
      const iface = liveTick.interfaces.find((i) => i.name === selectedChartInterface)
      rx = iface?.rx_rate ?? 0
      tx = iface?.tx_rate ?? 0
    }
    setLiveSeries((prev) => [...prev.slice(-59), { timestamp: liveTick.timestamp, rx_rate: rx, tx_rate: tx }])
  }, [liveTick, selectedChartInterface])

  // ── Eliminar balanceador ──
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/load-balancers/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['load-balancers'] })
      navigate('/load-balancers')
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.detail || 'Error al eliminar el balanceador')
    },
  })

  if (isLoadingLb) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando perfil del balanceador...</span>
        </div>
      </div>
    )
  }

  if (isErrorLb || !lb) {
    return (
      <div className="glass-card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Error al cargar el balanceador</h3>
        <p className="text-muted-foreground text-sm mb-6">
          El balanceador solicitado no existe o ha sido eliminado.
        </p>
        <button onClick={() => navigate('/load-balancers')} className="btn-secondary mx-auto">
          <ArrowLeft className="w-4 h-4" />
          Volver a Balanceadores
        </button>
      </div>
    )
  }

  const hasResponded = interfaces.length > 0
  const activePorts = interfaces.filter((i) => i.running && !i.disabled).length

  const tabs: Array<{ id: LbProfileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'info', label: 'Información', icon: Server },
    { id: 'balanceo', label: 'Balanceo', icon: Shuffle },
    { id: 'script', label: 'Script', icon: Terminal },
    { id: 'puertos', label: 'Puertos', icon: Network },
    { id: 'trafico', label: 'Tráfico en vivo', icon: Activity },
    { id: 'historial', label: 'Historial', icon: History },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Breadcrumb & Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/load-balancers')}
            className="w-10 h-10 rounded-lg bg-secondary/50 border border-border flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{lb.name}</h1>
              <RouterStatusBadge status={lb.status ?? 'unknown'} size="sm" />
              {hasResponded && (
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-secondary/60 text-muted-foreground border border-border/40 flex items-center gap-1">
                  <Wifi className="w-3 h-3" /> {activePorts}/{interfaces.length} puertos activos
                </span>
              )}
            </div>
            {lb.hw_model && <p className="text-xs text-muted-foreground mt-0.5">{lb.hw_model}</p>}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditOpen(true)} className="btn-primary">
              <Edit2 className="w-4 h-4" />
              Editar
            </button>
          </div>
        )}
      </div>

      {/* ── Navegación de Tabs ── */}
      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Secciones del balanceador">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
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

      {/* ── Pestaña: Información ── */}
      {activeTab === 'info' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
                <Key className="w-4.5 h-4.5" />
                <span>Información de Conexión</span>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="block text-xs text-muted-foreground">Dirección IP / Host</span>
                  <code className="text-sm font-mono text-foreground font-semibold">{lb.ip}:{lb.api_port}</code>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground">Usuario API</span>
                  <span className="text-sm text-foreground font-medium">{lb.api_username}</span>
                </div>
                {lb.ros_version && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Versión RouterOS</span>
                    <span className="text-sm text-foreground font-medium">{lb.ros_version}</span>
                  </div>
                )}
                {lb.uptime && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Tiempo Activo (Uptime)</span>
                    <span className="text-sm text-foreground font-medium">{formatUptime(lb.uptime)}</span>
                  </div>
                )}
                {lb.site_name && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Sitio</span>
                    <span className="text-sm text-foreground font-medium">{lb.site_name}</span>
                  </div>
                )}
                {lb.zerotier_node_id && (
                  <div>
                    <span className="block text-xs text-muted-foreground">ZeroTier</span>
                    <span className="text-sm text-foreground font-medium flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5" />
                      {lb.zerotier_node_id}
                    </span>
                  </div>
                )}
                {lb.notes && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Notas</span>
                    <span className="text-sm text-foreground">{lb.notes}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <MapPin className="w-4.5 h-4.5" />
              <span>Coordenadas GPS</span>
            </div>
            {lb.latitude && lb.longitude ? (
              <div className="rounded-lg overflow-hidden h-[300px] border border-border/40 relative z-10">
                <MapContainer center={[lb.latitude, lb.longitude]} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={[lb.latitude, lb.longitude]} icon={lbIcon}>
                    <Popup>
                      <div className="p-1 text-foreground font-sans">
                        <h4 className="font-bold text-sm text-amber-500 flex items-center gap-1.5 m-0">
                          <Shuffle className="w-3.5 h-3.5" />
                          {lb.name}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1 mb-0 font-mono">{lb.ip}</p>
                      </div>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground">Sin ubicación geográfica registrada.</p>
                {isAdmin && (
                  <button onClick={() => setEditOpen(true)} className="text-xs text-brand-400 hover:text-brand-300 font-bold mt-2 hover:underline">
                    Marcar ubicación en el mapa
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pestaña: Balanceo ── */}
      {activeTab === 'balanceo' && (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <Shuffle className="w-4.5 h-4.5" />
              <span>Algoritmo de balanceo</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleAlgorithmChange('pcc')}
                className={`text-left p-4 rounded-lg border transition-colors ${algorithm === 'pcc' ? 'border-brand-500 bg-brand-500/10' : 'border-border/40 hover:border-border'}`}
              >
                <p className="text-sm font-semibold text-foreground">PCC</p>
                <p className="text-xs text-muted-foreground mt-1">Per Connection Classifier — reparte el tráfico entre todos los enlaces WAN, manteniendo cada sesión estable en el mismo enlace. Ideal para balancear varias salidas a internet.</p>
              </button>
              <button
                type="button"
                onClick={() => handleAlgorithmChange('failover')}
                className={`text-left p-4 rounded-lg border transition-colors ${algorithm === 'failover' ? 'border-brand-500 bg-brand-500/10' : 'border-border/40 hover:border-border'}`}
              >
                <p className="text-sm font-semibold text-foreground">Failover</p>
                <p className="text-xs text-muted-foreground mt-1">Un enlace principal y uno o más de respaldo — conmuta automáticamente si el principal deja de responder (check-gateway).</p>
              </button>
            </div>
          </div>

          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm">
                <Network className="w-4.5 h-4.5" />
                <span>Enlaces WAN</span>
              </div>
              {isAdmin && (
                <button type="button" onClick={openAddLinkModal} className="btn-secondary text-xs py-1.5 px-3">
                  <Plus className="w-3.5 h-3.5" />
                  Agregar enlace
                </button>
              )}
            </div>

            {wanLinks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                No hay enlaces WAN configurados. Agrega al menos 2 para activar el balanceo de carga.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Interfaz</th>
                      <th>Estado</th>
                      <th>Gateway</th>
                      <th>Tráfico</th>
                      <th>{algorithm === 'pcc' ? 'Peso / Participación' : 'Prioridad / Rol'}</th>
                      {isAdmin && <th className="text-right">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totalWeight = wanLinks.reduce((acc, l) => acc + Math.max(1, l.weight), 0)
                      const failoverOrder = [...wanLinks]
                        .map((link, index) => ({ link, index }))
                        .sort((a, b) => a.link.priority - b.link.priority)
                      const roleByIndex: Record<number, string> = {}
                      failoverOrder.forEach(({ index }, order) => {
                        roleByIndex[index] = order === 0 ? 'Principal' : `Respaldo ${order}`
                      })

                      return wanLinks.map((link, index) => {
                        const iface = interfaces.find((i) => i.name === link.interface)
                        const sharePct = Math.round((Math.max(1, link.weight) / totalWeight) * 100)
                        return (
                          <tr key={index}>
                            <td className="font-mono text-sm font-semibold text-foreground">{link.interface}</td>
                            <td>
                              {iface ? (
                                <PortStatusBadge running={iface.running} disabled={iface.disabled} />
                              ) : (
                                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                                  Sin detectar
                                </span>
                              )}
                            </td>
                            <td className="font-mono text-xs text-muted-foreground">{link.gateway}</td>
                            <td className="font-mono text-xs">
                              {iface && iface.running ? (
                                <>
                                  <span className="text-cyan-400 font-semibold">↓ {formatSpeed(iface.rx_rate)}</span>
                                  {' '}
                                  <span className="text-violet-400 font-semibold">↑ {formatSpeed(iface.tx_rate)}</span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td>
                              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20 whitespace-nowrap">
                                {algorithm === 'pcc'
                                  ? `Peso ${link.weight} · ~${sharePct}%`
                                  : `${roleByIndex[index]} · prioridad ${link.priority}`}
                              </span>
                            </td>
                            {isAdmin && (
                              <td className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button type="button" onClick={() => openEditLinkModal(index)} className="btn-secondary py-1 px-2.5 text-xs">
                                    <Pencil className="w-3.5 h-3.5" />
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveLink(index)}
                                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    title="Quitar enlace"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>
            )}
            {wanLinks.length === 1 && (
              <p className="text-xs text-amber-400">Agrega al menos un enlace más para poder aplicar el balanceo en el equipo.</p>
            )}

            {isAdmin && wanLinks.length >= 2 && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/30">
                <p className="text-xs text-muted-foreground">
                  {pendingApply
                    ? 'Hay cambios sin aplicar en el equipo.'
                    : 'La configuración guardada coincide con la última aplicada.'}
                </p>
                <button
                  type="button"
                  onClick={handleApplyTemplate}
                  disabled={applyTemplateMutation.isPending}
                  className={saveButtonClass(pendingApply, applyTemplateMutation.isPending)}
                >
                  {applyTemplateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar y aplicar en el equipo
                </button>
              </div>
            )}
          </div>

          {applyResult && (
            <div className={`glass-card p-5 space-y-3 border ${applyResult.success ? 'border-emerald-500/30' : 'border-destructive/30'}`}>
              <div className="flex items-start gap-3">
                {applyResult.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                )}
                <p className={`text-sm font-semibold ${applyResult.success ? 'text-emerald-400' : 'text-destructive'}`}>
                  {applyResult.message}
                </p>
              </div>
              {applyResult.source && (
                <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{applyResult.source}</pre>
              )}
              {applyResult.output && (
                <pre className="text-xs font-mono text-destructive bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{applyResult.output}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Pestaña: Script ── */}
      {activeTab === 'script' && (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <Terminal className="w-4.5 h-4.5" />
              <span>Último script aplicado</span>
            </div>
            {lb.last_script_source ? (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`uppercase font-bold px-2 py-0.5 rounded-full ${lb.last_script_status === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                    }`}>
                    {lb.last_script_status === 'success' ? 'Exitoso' : 'Con errores'}
                  </span>
                  {lb.last_script_applied_at && <span>{formatDateTime(lb.last_script_applied_at, dateFormat, timeFormat)}</span>}
                </div>
                <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap max-h-64">{lb.last_script_source}</pre>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Todavía no se ha aplicado ningún script en este balanceador.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Pestaña: Puertos ── */}
      {activeTab === 'puertos' && (
        <div className="glass-card overflow-x-auto">
          {interfaces.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
              Aún no hay datos de interfaces. El sondeo corre cada 5 segundos.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Interfaz</th>
                  <th>Estado</th>
                  <th>Descarga (RX)</th>
                  <th>Subida (TX)</th>
                  <th>Consumo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {interfaces.map((iface) => (
                  <tr key={iface.name}>
                    <td className="font-mono text-sm font-semibold text-foreground">{iface.name}</td>
                    <td><PortStatusBadge running={iface.running} disabled={iface.disabled} /></td>
                    <td className="font-mono text-xs text-cyan-400 font-bold">{formatSpeed(iface.rx_rate)}</td>
                    <td className="font-mono text-xs text-violet-400 font-bold">{formatSpeed(iface.tx_rate)}</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      ↓ {formatBytes(iface.rx_bytes)} / ↑ {formatBytes(iface.tx_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Pestaña: Tráfico en vivo ── */}
      {activeTab === 'trafico' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand-400" />
              Interfaz a graficar
            </label>
            <select
              value={selectedChartInterface}
              onChange={(e) => setSelectedChartInterface(e.target.value)}
              className="input-field cursor-pointer w-auto text-sm"
            >
              <option value="__all__">Todas las interfaces (suma)</option>
              {interfaces.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
            </select>
          </div>
          <div className="glass-card p-4">
            {liveSeries.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Esperando datos en vivo...
              </div>
            ) : (
              <TrafficChart data={liveSeries} range="live" height={300} />
            )}
          </div>
        </div>
      )}

      {/* ── Pestaña: Historial ── */}
      {activeTab === 'historial' && (
        <div className="glass-card overflow-x-auto">
          {scriptRuns.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <ClipboardList className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
              No se ha ejecutado ningún script todavía.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Resultado</th>
                  <th>Ejecutado por</th>
                </tr>
              </thead>
              <tbody>
                {scriptRuns.map((run) => (
                  <tr key={run.id} onClick={() => setSelectedRun(run)} className="cursor-pointer hover:bg-secondary/40 transition-colors">
                    <td className="text-xs font-mono text-muted-foreground">{formatDateTime(run.created_at, dateFormat, timeFormat)}</td>
                    <td>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20">
                        {run.origin === 'template' ? `Plantilla (${run.algorithm ?? '—'})` : 'Script libre'}
                      </span>
                    </td>
                    <td>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${run.success
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-destructive/10 text-destructive border border-destructive/20'
                        }`}>
                        {run.success ? 'Éxito' : 'Error'}
                      </span>
                    </td>
                    <td className="text-xs text-foreground">{run.executed_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Dialog de edición ── */}
      <LoadBalancerFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        loadBalancer={lb}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['load-balancer', id] })
          queryClient.invalidateQueries({ queryKey: ['load-balancers'] })
          setEditOpen(false)
        }}
        onDelete={() => { setEditOpen(false); setConfirmDeleteOpen(true) }}
      />

      {/* ── Dialog de enlace WAN (agregar/editar) ── */}
      <WanLinkFormDialog
        open={linkModalOpen}
        onClose={() => { setLinkModalOpen(false); setEditingLinkIndex(null) }}
        algorithm={algorithm}
        link={editingLinkIndex !== null ? wanLinks[editingLinkIndex] ?? null : null}
        availableInterfaces={interfaces.map((i) => i.name)}
        isSaving={saveBalancingMutation.isPending}
        onSave={handleLinkModalSave}
      />

      {/* ── Confirmación de eliminación ── */}
      {confirmDeleteOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar balanceador?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              El balanceador quedará desactivado y dejará de aparecer en el listado.
            </p>
            {deleteError && (
              <div className="p-3 mb-4 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs">{deleteError}</div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setConfirmDeleteOpen(false); setDeleteError(null) }} className="btn-secondary flex-1 justify-center">
                Cancelar
              </button>
              <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="btn-destructive flex-1 justify-center">
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Detalle de ejecución de script ── */}
      {selectedRun && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-2xl mx-4 animate-fade-in max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
              <h3 className="text-lg font-semibold text-foreground">Detalle de ejecución</h3>
              <button onClick={() => setSelectedRun(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDateTime(selectedRun.created_at, dateFormat, timeFormat)}</span>
                <span>·</span>
                <span>{selectedRun.origin === 'template' ? `Plantilla (${selectedRun.algorithm ?? '—'})` : 'Script libre'}</span>
                <span>·</span>
                <span>{selectedRun.executed_by_name ?? '—'}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground mb-1.5">Script ejecutado</p>
                <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{selectedRun.source}</pre>
              </div>
              {selectedRun.output && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1.5">Salida</p>
                  <pre className={`text-xs font-mono p-3 rounded border overflow-x-auto whitespace-pre-wrap ${selectedRun.success ? 'bg-black/30 border-border/50 text-muted-foreground' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                    {selectedRun.output}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
