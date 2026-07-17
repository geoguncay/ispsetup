/**
 * ClientProfilePage — Ficha del cliente, historial de planes, acciones de red y mapa de ubicación GPS.
 */
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, RefreshCw, MapPin, Shield, User,
  Wifi, CheckCircle2, XCircle, AlertCircle, Loader2, X, Plus, MessageSquare,
  Edit2, Trash2, FileText, Download, UploadCloud, CreditCard, Wallet, CalendarClock, Ban
} from 'lucide-react'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { ToastContainer } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { ClientFormDialog } from '@/components/ClientFormDialog'
import { PaymentRegisterDialog } from '@/components/PaymentRegisterDialog'
import { InvoiceCreateDialog } from '@/components/InvoiceCreateDialog'
import TrafficChart from '@/components/TrafficChart'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate, toDatetimeLocalValue } from '@/lib/utils'

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
  plan: { name: string; speed_down_mbps: number; speed_up_mbps: number; price: number } | null
}

const TICKET_PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
}

const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En proceso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}

export function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toasts, addToast, removeToast } = useToast()
  const dateFormat = useDateFormat()

  const [activeTab, setActiveTab] = useState<'plans' | 'suspensions' | 'payments' | 'tickets' | 'traffic' | 'documents'>('traffic')
  const [isUploading, setIsUploading] = useState(false)
  const [documents, setDocuments] = useState([
    { id: '1', name: 'Contrato_de_Servicio_ISP.pdf', size: '1.2 MB', date: '2026-05-10' },
    { id: '2', name: 'Cedula_Identidad_Scan.pdf', size: '840 KB', date: '2026-05-10' },
    { id: '3', name: 'Croquis_Instalacion.png', size: '2.4 MB', date: '2026-05-12' },
  ])
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [deferOpen, setDeferOpen] = useState(false)
  const [confirmCancelDeferOpen, setConfirmCancelDeferOpen] = useState(false)
  const [confirmCancelReactivationOpen, setConfirmCancelReactivationOpen] = useState(false)
  const [confirmDisconnectSessionOpen, setConfirmDisconnectSessionOpen] = useState(false)
  const [deferReactivationOpen, setDeferReactivationOpen] = useState(false)
  const [deferReactivationDate, setDeferReactivationDate] = useState('')
  const [suspensionReason, setSuspensionReason] = useState('')
  const [suspensionReasons, setSuspensionReasons] = useState<string[]>([])
  const [deferDate, setDeferDate] = useState('')
  const [suspendUntilMode, setSuspendUntilMode] = useState<'indefinido' | 'hasta'>('indefinido')
  const [suspendUntilDate, setSuspendUntilDate] = useState('')
  const allowDeferral = localStorage.getItem('isp_suspension_allow_deferral') !== 'false'

  useEffect(() => {
    if (suspendOpen || deferOpen) {
      const saved = localStorage.getItem('isp_suspension_reasons_list')
      const defaults = ['Falta de pago', 'Solicitud del cliente', 'Mantenimiento', 'Incumplimiento de contrato']
      if (saved) {
        try { setSuspensionReasons(JSON.parse(saved)) } catch { setSuspensionReasons(defaults) }
      } else {
        setSuspensionReasons(defaults)
      }
      setSuspensionReason('')
      setDeferDate('')
      setSuspendUntilMode('indefinido')
      setSuspendUntilDate('')
    }
  }, [suspendOpen, deferOpen])

  useEffect(() => {
    if (deferReactivationOpen) {
      setDeferReactivationDate('')
    }
  }, [deferReactivationOpen])

  // Facturas y Recibos
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null)
  const [receiptLoadingMap, setReceiptLoadingMap] = useState<Record<string, boolean>>({})
  const [manualInvoiceOpen, setManualInvoiceOpen] = useState(false)

  // Descargar Recibo PDF mediante Fetch de Blob
  const handleDownloadReceipt = async (pagoId: string) => {
    if (!pagoId) return
    setReceiptLoadingMap(prev => ({ ...prev, [pagoId]: true }))
    try {
      const response = await api.get(`/payments/${pagoId}/receipt`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `recibo_${pagoId.substring(0, 8).toUpperCase()}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      addToast('Error al descargar el comprobante en PDF', 'error')
    } finally {
      setReceiptLoadingMap(prev => ({ ...prev, [pagoId]: false }))
    }
  }


  // Ticket creation form state
  const [createTicketOpen, setCreateTicketOpen] = useState(false)
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDesc, setTicketDesc] = useState('')
  const [ticketPriority, setTicketPriority] = useState('medium')

  // Edit and Delete client state & mutation
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const anyModalOpen = editOpen || confirmDeleteOpen || changePlanOpen || suspendOpen ||
    deferOpen || confirmCancelDeferOpen || confirmCancelReactivationOpen ||
    confirmDisconnectSessionOpen || deferReactivationOpen || manualInvoiceOpen || createTicketOpen

  const deleteClientMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients', {
        state: { toast: { type: 'success', message: `Cliente "${client?.name}" eliminado correctamente.` } }
      })
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.detail || 'Error al eliminar el cliente de la base de datos')
    }
  })

  // Consultar Cliente
  // refetchInterval: detecta suspensiones/reactivaciones programadas que el worker
  // de Celery aplica en segundo plano, sin que el usuario tenga que recargar la página.
  const { data: client, isLoading, isError, refetch } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 30_000,
  })

  // Detecta cambios de estado que llegaron por el worker automático (no por una acción
  // manual del usuario en esta misma pestaña) y muestra un toast.
  const prevClientStateRef = useRef<{ active: boolean; scheduled_suspension: string | null; scheduled_reactivation: string | null } | null>(null)
  const suppressAutoToastRef = useRef(false)

  useEffect(() => {
    if (!client) return
    const prev = prevClientStateRef.current
    const current = {
      active: client.active,
      scheduled_suspension: client.scheduled_suspension ?? null,
      scheduled_reactivation: client.scheduled_reactivation ?? null,
    }

    if (prev && !suppressAutoToastRef.current) {
      if (prev.active && !current.active && prev.scheduled_suspension && !current.scheduled_suspension) {
        addToast('La suspensión programada se aplicó automáticamente.', 'warning')
      } else if (!prev.active && current.active && prev.scheduled_reactivation && !current.scheduled_reactivation) {
        addToast('El cliente se reactivó automáticamente según lo programado.', 'success')
      }
    }

    suppressAutoToastRef.current = false
    prevClientStateRef.current = current
  }, [client])

  // Consultar Estado de Sesión PPPoE (solo si es PPPoE y el gateway_id está disponible)
  const { data: pppoeSessions = [], refetch: refetchSessions } = useQuery<any[]>({
    queryKey: ['gateway-pppoe-sessions', client?.gateway_id],
    queryFn: async () => {
      if (!client?.gateway_id) return []
      const { data } = await api.get(`/gateways/${client.gateway_id}/pppoe-sessions`)
      return data
    },
    enabled: !!client && client.connection_type === 'pppoe' && !!client.gateway_id,
    refetchInterval: anyModalOpen ? false : 10000,
  })

  // Buscar la sesión correspondiente a este cliente
  const activeSession = pppoeSessions.find(
    (s) => s.username === client?.pppoe_secret?.ppp_username
  )

  // Mutación para desconectar sesión activa
  const disconnectSessionMutation = useMutation({
    mutationFn: async () => {
      if (!client?.gateway_id || !client?.pppoe_secret?.ppp_username) return
      await api.delete(`/gateways/${client.gateway_id}/pppoe-sessions/${client.pppoe_secret.ppp_username}`)
    },
    onSuccess: () => {
      refetchSessions()
      addToast('Sesión PPPoE desconectada correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al desconectar la sesión activa'
      addToast(msg, 'error')
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

  // Consultar Facturas del Cliente
  const { data: invoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['client-invoices', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/invoices`)
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
    if (trafficRange !== 'live' || !client?.gateway_id) return

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
      return `${wsProtocol}//${wsHost}/api/traffic/ws/${client.gateway_id}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const timestamp = payload.timestamp
        const clients = payload.clients || []
        const mySample = clients.find((c: any) => c.client_id === id)

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
  }, [id, client?.gateway_id, trafficRange])

  // Mutación para Registrar Ticket
  const createTicketMutation = useMutation({
    mutationFn: async (payload: { title: string; description: string; priority: string }) => {
      await api.post(`/clients/${id}/tickets`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-tickets', id] })
      setCreateTicketOpen(false)
      setTicketTitle('')
      setTicketDesc('')
      setTicketPriority('medium')
      addToast('Ticket registrado correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al registrar ticket'
      addToast(msg, 'error')
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
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setChangePlanOpen(false)
      setSelectedPlanId('')
      setErrorMessage(null)
      addToast('Plan actualizado correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al cambiar de plan'
      setErrorMessage(msg)
    }
  })

  // Mutación para suspender cliente
  const suspendClientMutation = useMutation({
    mutationFn: async ({ reason, reactivateAt }: { reason: string; reactivateAt?: string }) => {
      await api.post(`/clients/${id}/suspend`, null, {
        params: { reason, ...(reactivateAt ? { reactivate_at: reactivateAt } : {}) }
      })
    },
    onSuccess: () => {
      suppressAutoToastRef.current = true
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-suspensions', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setSuspendOpen(false)
      setSuspensionReason('')
      setSuspendUntilMode('indefinido')
      setSuspendUntilDate('')
      addToast('Cliente suspendido correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al suspender al cliente'
      addToast(msg, 'error')
    }
  })

  // Mutación para aplazar suspensión a una fecha específica
  const deferClientMutation = useMutation({
    mutationFn: async ({ deferUntil, reason }: { deferUntil: string; reason: string }) => {
      await api.post(`/clients/${id}/defer-suspension`, null, {
        params: { defer_until: deferUntil, reason }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeferOpen(false)
      setSuspensionReason('')
      setDeferDate('')
      addToast('Suspensión programada correctamente.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al programar la suspensión', 'error')
    }
  })

  // Mutación para cancelar una suspensión aplazada
  const cancelDeferMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}/defer-suspension`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Suspensión programada cancelada.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al cancelar el aplazamiento', 'error')
    }
  })

  // Mutación para cancelar una reactivación programada (suspensión "hasta" una fecha)
  const cancelScheduledReactivationMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}/scheduled-reactivation`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Reactivación programada cancelada.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al cancelar la reactivación programada', 'error')
    }
  })

  // Mutación para programar (o reprogramar) la reactivación automática de un cliente ya suspendido
  const deferReactivationMutation = useMutation({
    mutationFn: async (reactivateAt: string) => {
      await api.post(`/clients/${id}/scheduled-reactivation`, null, { params: { reactivate_at: reactivateAt } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeferReactivationOpen(false)
      setDeferReactivationDate('')
      addToast('Reactivación programada correctamente.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al programar la reactivación', 'error')
    }
  })

  // Mutación para reactivar cliente
  const reactivateClientMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/clients/${id}/reactivate`)
    },
    onSuccess: () => {
      suppressAutoToastRef.current = true
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-suspensions', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Cliente reactivado correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al reactivar al cliente'
      addToast(msg, 'error')
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

  // Suspensión activa (la más reciente sin fecha de reactivación), usada para el banner de detalle
  const activeSuspension = suspensionHistory.find((sh: any) => !sh.reactivated_at)



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
              {/* Badge */}
              {client.active && client.scheduled_suspension ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/25">
                  <CalendarClock className="w-3.5 h-3.5" />
                  Programado
                </span>
              ) : client.active ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Activo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/25">
                  <XCircle className="w-3.5 h-3.5" />
                  Suspendido
                </span>
              )}

              {client.active ? (
                <>
                  {/* Botón Aplazar (abre modal independiente) */}
                  {allowDeferral && (
                    <button
                      onClick={() => setDeferOpen(true)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/25"
                    >
                      Aplazar
                    </button>
                  )}

                  {/* Botón Suspender (abre modal independiente) */}
                  <button
                    onClick={() => setSuspendOpen(true)}
                    disabled={suspendClientMutation.isPending}
                    className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/25"
                  >
                    {suspendClientMutation.isPending ? 'Cargando...' : 'Suspender'}
                  </button>
                </>
              ) : (
                <>
                  {/* Botón Aplazar (programar reactivación automática) */}
                  {allowDeferral && (
                    <button
                      onClick={() => setDeferReactivationOpen(true)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/25"
                    >
                      Aplazar
                    </button>
                  )}

                  <button
                    onClick={() => reactivateClientMutation.mutate()}
                    disabled={reactivateClientMutation.isPending}
                    className="text-xs px-2.5 py-1.5 rounded-lg border font-medium active:scale-[0.98] transition-all duration-200 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/25"
                  >
                    {reactivateClientMutation.isPending ? 'Cargando...' : 'Reactivar'}
                  </button>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-1">{client.name}</h1>
                <p className="text-xs text-muted-foreground font-mono">ID: {client.id}</p>
              </div>

              {/* Grid Datos Agrupados */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 border-t border-border/50 pt-5 mt-2">
                {/* 1. Datos Personales */}
                <div className="glass-card p-4 border border-border/60 bg-secondary/5 space-y-4 font-sans">
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/30">
                    <User className="w-3.5 h-3.5" /> Información Personal
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Identificación:</span>
                      <span className="font-semibold text-foreground font-mono">{client.cedula}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Teléfono:</span>
                      <span className="font-semibold text-foreground">{client.phone}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Correo:</span>
                      <span className="font-semibold text-foreground break-all">{client.email || '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-border/20 gap-0.5">
                      <span className="text-muted-foreground">Dirección:</span>
                      <span className="font-semibold text-foreground leading-normal">{client.address}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Fecha Registro:</span>
                      <span className="font-semibold text-foreground">{formatDate(client.created_at, dateFormat)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Plan y Facturación */}
                <div className="glass-card p-4 border border-border/60 bg-secondary/5 space-y-4 font-sans">
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/30">
                    <CreditCard className="w-3.5 h-3.5" /> Plan y Facturación
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Plan Contratado:</span>
                      <span className="font-bold text-brand-300">
                        {client.plan_activo?.name || 'Sin Plan'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Mensualidad:</span>
                      <span className="font-mono font-bold text-foreground">
                        ${Number(client.plan_activo?.price || 0).toFixed(2)}/mes
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Inicio Facturación:</span>
                      <span className="font-semibold text-foreground font-mono">
                        {client.billing_start ? formatDate(client.billing_start, dateFormat) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Ciclo:</span>
                      <span className="font-semibold text-foreground">
                        Día {client.billing_period_start_day || 1}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Tipo de Facturación:</span>
                      <span className="font-semibold text-foreground">
                        {client.billing_type === 'backward' ? 'Postpago' : 'Prepago'}
                      </span>
                    </div>
                    <div className="flex flex-col py-1 gap-1">
                      <span className="text-muted-foreground">Servicios Adicionales:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {client.custom_services && client.custom_services.length > 0 ? (
                          client.custom_services.map((cs: any) => (
                            <span
                              key={cs.id}
                              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${
                                cs.recurring
                                  ? 'bg-brand-500/10 text-brand-400 border-brand-500/20'
                                  : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              }`}
                              title={cs.description || ''}
                            >
                              {cs.name} (${Number(cs.price).toFixed(2)})
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">Ninguno</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Conectividad y Red */}
                <div className="glass-card p-4 border border-border/60 bg-secondary/5 space-y-4 font-sans">
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/30">
                    <Wifi className="w-3.5 h-3.5" /> Conectividad y Red
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Tipo Conexión:</span>
                      <span className="font-semibold text-foreground uppercase">{client.connection_type === 'static' ? 'IP Estática' : 'PPPoE'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Gateway:</span>
                      <span className="font-semibold text-foreground truncate max-w-[150px]">{client.gateway_name ?? '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Sitio / Ubicación:</span>
                      <span className="font-semibold text-foreground font-sans">
                        {client.site_name ? (
                          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.2 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                            {client.site_name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>

                    {client.connection_type === 'static' ? (
                      <>
                        <div className="flex justify-between py-1 border-b border-border/20">
                          <span className="text-muted-foreground">IP WAN:</span>
                          <span className="font-semibold text-foreground font-mono">{client.static_ip?.ip ?? 'No Asignada'}</span>
                        </div>
                        {client.static_ip?.notes && (
                          <div className="flex flex-col py-1 border-t border-border/20 mt-1 gap-0.5">
                            <span className="text-muted-foreground">Notas de IP:</span>
                            <span className="text-foreground leading-normal italic">{client.static_ip.notes}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between py-1 border-b border-border/20">
                          <span className="text-muted-foreground">Usuario PPPoE:</span>
                          <span className="font-semibold text-foreground font-mono">{client.pppoe_secret?.ppp_username ?? 'No Configurado'}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-muted-foreground">Contraseña:</span>
                          <span className="font-semibold text-foreground font-mono">{client.pppoe_secret?.ppp_password ?? 'No Configurada'}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Banner: Suspensión programada */}
              {client.active && client.scheduled_suspension && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <span className="text-xs font-semibold text-amber-300 block">Suspensión programada</span>
                      <span className="text-xs text-amber-400/80">
                        Este cliente será suspendido automáticamente el{' '}
                        <strong className="text-amber-200">
                          {formatDate(client.scheduled_suspension, dateFormat)}
                        </strong>{' '}
                        a las{' '}
                        <strong className="text-amber-200">
                          {new Date(client.scheduled_suspension).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </strong>.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmCancelDeferOpen(true)}
                    disabled={cancelDeferMutation.isPending}
                    className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Banner: Cliente suspendido (detalle de la suspensión activa) */}
              {!client.active && activeSuspension && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                    <div>
                      <span className="text-xs font-semibold text-rose-300 block">Cliente suspendido</span>
                      <span className="text-xs text-rose-400/80">
                        Motivo: <strong className="text-rose-200">{activeSuspension.reason}</strong>
                        {' '}— desde el{' '}
                        <strong className="text-rose-200">
                          {formatDate(activeSuspension.suspended_at, dateFormat)}
                        </strong>{' '}
                        a las{' '}
                        <strong className="text-rose-200">
                          {new Date(activeSuspension.suspended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </strong>
                        {' '}por{' '}
                        <strong className="text-rose-200">{activeSuspension.user_name || 'el sistema (automático)'}</strong>.
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => reactivateClientMutation.mutate()}
                    disabled={reactivateClientMutation.isPending}
                    className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 transition-all"
                  >
                    {reactivateClientMutation.isPending ? 'Reactivando...' : 'Cancelar'}
                  </button>
                </div>
              )}

              {/* Banner: Reactivación programada (suspensión "hasta" una fecha) */}
              {!client.active && client.scheduled_reactivation && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <div>
                      <span className="text-xs font-semibold text-amber-300 block">Reactivación programada</span>
                      <span className="text-xs text-amber-400/80">
                        Este cliente será reactivado automáticamente el{' '}
                        <strong className="text-amber-200">
                          {formatDate(client.scheduled_reactivation, dateFormat)}
                        </strong>{' '}
                        a las{' '}
                        <strong className="text-amber-200">
                          {new Date(client.scheduled_reactivation).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </strong>.
                        {' '}por{' '}
                        <strong className="text-rose-200">{activeSuspension.user_name || 'el sistema (automático)'}</strong>.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmCancelReactivationOpen(true)}
                    disabled={cancelScheduledReactivationMutation.isPending}
                    className="shrink-0 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Estado de la Sesión en tiempo real (solo si es pppoe) */}
              {client.connection_type === 'pppoe' && (
                <div className="border-t border-border/50 pt-4 mt-4 space-y-3 font-sans">
                  <div className="bg-secondary/10 p-4 rounded-lg border border-border/30 space-y-3">
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
                            onClick={() => setConfirmDisconnectSessionOpen(true)}
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Columna Facturas */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-border/40 pb-2">
                      <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" /> Facturas Emitidas
                      </h3>
                      <button
                        onClick={() => setManualInvoiceOpen(true)}
                        className="btn-primary text-[10px] py-1 px-2.5 h-auto flex items-center gap-1 font-semibold"
                      >
                        <Plus className="w-3 h-3" /> Nueva Factura
                      </button>
                    </div>
                    {isLoadingInvoices ? (
                      <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Cargando facturas...
                      </div>
                    ) : invoices.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground bg-secondary/10 rounded-lg border border-border/50">Sin facturas emitidas.</p>
                    ) : (
                      <div className="overflow-x-auto font-sans glass-card p-2 border-border/40">
                        <table className="data-table text-xs">
                          <thead>
                            <tr>
                              <th>Periodo</th>
                              <th>Monto</th>
                              <th>Vence</th>
                              <th>Estado</th>
                              <th className="text-right">Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map((inv: any) => (
                              <tr key={inv.id} className="hover:bg-secondary/20 transition-all">
                                <td className="font-bold text-foreground">{inv.period}</td>
                                <td className="font-bold text-brand-400 font-mono">${Number(inv.amount).toFixed(2)}</td>
                                <td className="text-muted-foreground font-mono">{formatDate(inv.due_date, dateFormat)}</td>
                                <td>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${
                                    inv.status === 'paid'
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                      : inv.status === 'pending'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                                        : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                                  }`}>
                                    {inv.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="text-right">
                                  {inv.status !== 'paid' ? (
                                    <button
                                      onClick={() => setSelectedInvoice({
                                        ...inv,
                                        client_name: client?.name ?? 'Cliente',
                                        client_cedula: client?.cedula ?? 'N/A'
                                      })}
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit ml-auto"
                                    >
                                      <CreditCard className="w-3 h-3" /> Cobrar
                                    </button>
                                  ) : inv.payment_id ? (
                                    <button
                                      disabled={receiptLoadingMap[inv.payment_id]}
                                      onClick={() => handleDownloadReceipt(inv.payment_id)}
                                      className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit ml-auto disabled:opacity-50"
                                    >
                                      {receiptLoadingMap[inv.payment_id] ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Download className="w-3 h-3" />
                                      )}
                                      PDF
                                    </button>
                                  ) : (
                                    <span className="text-muted-foreground text-[10px]">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Columna Historial Pagos */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-emerald-400" /> Historial de Pagos
                    </h3>
                    {isLoadingPayments ? (
                      <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Cargando pagos...
                      </div>
                    ) : payments.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground bg-secondary/10 rounded-lg border border-border/50">Sin cobros registrados.</p>
                    ) : (
                      <div className="overflow-x-auto font-sans glass-card p-2 border-border/40">
                        <table className="data-table text-xs">
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Monto</th>
                              <th>Método</th>
                              <th>Notas</th>
                              <th className="text-right">Comprobante</th>
                            </tr>
                          </thead>
                          <tbody>
                            {payments.map((p: any) => (
                              <tr key={p.id} className="hover:bg-secondary/20 transition-all">
                                <td className="text-muted-foreground font-mono">
                                  {formatDate(p.payment_date, dateFormat)}
                                </td>
                                <td className="font-bold text-emerald-400 font-mono">${Number(p.amount).toFixed(2)}</td>
                                <td className="capitalize font-medium text-foreground">{p.method}</td>
                                <td className="text-muted-foreground truncate max-w-[100px]" title={p.notes}>{p.notes ?? '-'}</td>
                                <td className="text-right">
                                  <button
                                    disabled={receiptLoadingMap[p.id]}
                                    onClick={() => handleDownloadReceipt(p.id)}
                                    className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1.5 ml-auto disabled:opacity-50"
                                  >
                                    {receiptLoadingMap[p.id] ? (
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Download className="w-3 h-3" />
                                    )}
                                    Recibo
                                  </button>
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

              {activeTab === 'plans' && (
                <div className="space-y-6 font-sans">
                  {/* Sección destacada de Servicios Activos */}
                  <div className="glass-card p-5 border border-brand-500/20 bg-brand-500/5 space-y-4">
                    <h3 className="text-sm font-bold text-brand-300 uppercase tracking-wider flex items-center gap-2">
                      <Shield className="w-4 h-4 text-brand-400" /> Servicios Contratados en Curso
                    </h3>
                    <div className="divide-y divide-border/40 text-xs">
                      {/* Plan Base */}
                      <div className="flex justify-between py-2.5 items-center">
                        <div>
                          <span className="font-semibold text-foreground text-sm block">
                            {client.plan_activo?.name ?? 'Sin plan activo contratado'}
                          </span>
                          <span className="text-muted-foreground text-[11px]">Plan de Internet base</span>
                        </div>
                        <span className="font-bold text-brand-400 font-mono text-sm">
                          ${client.plan_activo ? Number(client.plan_activo.price).toFixed(2) : '0.00'} /mes
                        </span>
                      </div>

                      {/* Servicios Adicionales */}
                      {client.custom_services && client.custom_services.map((cs: any) => (
                        <div key={cs.id} className="flex justify-between py-2.5 items-center">
                          <div>
                            <span className="font-semibold text-foreground text-sm flex items-center gap-2">
                              {cs.name}
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.1 rounded border ${
                                cs.recurring
                                  ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                  : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                              }`}>
                                {cs.recurring ? 'Mensual' : 'Pago Único'}
                              </span>
                            </span>
                            <span className="text-muted-foreground text-[11px]">{cs.description || 'Servicio de valor agregado'}</span>
                          </div>
                          <span className="font-bold text-brand-400 font-mono text-sm">
                            +${Number(cs.price).toFixed(2)} {cs.recurring ? '/mes' : ''}
                          </span>
                        </div>
                      ))}

                      {/* Totales Desglosados */}
                      {client.custom_services && client.custom_services.some((cs: any) => !cs.recurring) ? (
                        <>
                          <div className="flex justify-between py-2 border-t border-border/40 font-semibold text-muted-foreground">
                            <span>Total Mensual Recurrente:</span>
                            <span className="font-mono text-foreground">
                              ${(
                                (client.plan_activo ? Number(client.plan_activo.price) : 0) +
                                (client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + (cs.recurring ? Number(cs.price) : 0), 0) : 0)
                              ).toFixed(2)} /mes
                            </span>
                          </div>
                          <div className="flex justify-between py-2 font-semibold text-purple-400">
                            <span>Cargos Únicos Pendientes:</span>
                            <span className="font-mono text-purple-400">
                              +${(
                                client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + (!cs.recurring ? Number(cs.price) : 0), 0) : 0
                              ).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between py-3 items-center border-t border-border font-bold">
                            <div>
                              <span className="text-sm text-foreground uppercase tracking-wider block">Monto Próxima Factura</span>
                              <span className="text-[10px] text-muted-foreground font-normal">Suma de mensualidad y cargos únicos pendientes</span>
                            </div>
                            <span className="text-lg font-mono font-black text-brand-400">
                              ${(
                                (client.plan_activo ? Number(client.plan_activo.price) : 0) +
                                (client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + Number(cs.price), 0) : 0)
                              ).toFixed(2)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between py-3 items-center border-t border-border font-bold">
                          <div>
                            <span className="text-sm text-foreground uppercase tracking-wider block">Total de Facturación Mensual</span>
                            <span className="text-[10px] text-muted-foreground font-normal">Valor aproximado antes de impuestos adicionales</span>
                          </div>
                          <span className="text-lg font-mono font-black text-brand-400">
                            ${(
                              (client.plan_activo ? Number(client.plan_activo.price) : 0) +
                              (client.custom_services ? client.custom_services.reduce((acc: number, cs: any) => acc + Number(cs.price), 0) : 0)
                            ).toFixed(2)} /mes
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Historial de Planes Asignados */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Historial de Asignación de Planes
                    </h3>
                    {isLoadingHistory ? (
                      <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Cargando historial...
                      </div>
                    ) : planHistory.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground bg-secondary/10 rounded-lg border border-border/50">Sin historial de planes asignados.</p>
                    ) : (
                      <div className="overflow-x-auto glass-card p-2 border-border/40">
                        <table className="data-table text-xs">
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
                                <td className="font-semibold text-foreground text-sm">{ph.plan?.name ?? 'Plan Eliminado'}</td>
                                <td className="font-mono text-xs">${ph.plan ? Number(ph.plan.price).toFixed(2) : '0.00'}</td>
                                <td className="text-xs text-muted-foreground font-mono">{formatDate(ph.fecha_inicio, dateFormat)}</td>
                                <td className="text-xs text-muted-foreground font-mono">
                                  {ph.fecha_fin ? formatDate(ph.fecha_fin, dateFormat) : <span className="text-emerald-400 font-medium">Actual</span>}
                                </td>
                                <td>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${ph.estado === 'activo'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                    : ph.estado === 'suspendido'
                                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                                      : 'bg-muted text-muted-foreground border border-border'
                                    }`}>
                                    {ph.estado.toUpperCase()}
                                  </span>
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
                            <td className="text-sm font-semibold text-foreground max-w-xs truncate" title={sh.reason}>
                              {sh.reason}
                            </td>
                            <td className="text-xs text-muted-foreground font-mono">
                              {formatDate(sh.suspended_at, dateFormat)} {new Date(sh.suspended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="text-xs text-muted-foreground font-mono">
                              {sh.reactivated_at ? (
                                `${formatDate(sh.reactivated_at, dateFormat)} ${new Date(sh.reactivated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                              ) : (
                                <span className="text-rose-400 font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 text-[10px]">Suspendido</span>
                              )}
                            </td>
                            <td className="text-xs text-foreground font-medium">
                              {sh.user_name ? (
                                <span>{sh.user_name} <span className="text-muted-foreground text-[10px]">(Manual)</span></span>
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
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${t.priority === 'high'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : t.priority === 'medium'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                              {TICKET_PRIORITY_LABELS[t.priority] ?? t.priority}
                            </span>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${t.status === 'resolved'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : t.status === 'open'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                              {TICKET_STATUS_LABELS[t.status] ?? t.status}
                            </span>
                          </div>

                          <div className="pr-24 space-y-1">
                            <h4 className="text-sm font-semibold text-foreground">{t.title}</h4>
                            <p className="text-xs text-muted-foreground font-mono">
                              Creado: {formatDate(t.created_at, dateFormat)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-3 leading-relaxed">{t.description}</p>
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
                                  name: file.name,
                                  size: file.size > 1024 * 1024
                                    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                                    : `${(file.size / 1024).toFixed(0)} KB`,
                                  date: new Date().toISOString().split('T')[0],
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
                              {doc.name}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {doc.size} • {formatDate(doc.date, dateFormat)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              alert(`Descargando archivo: ${doc.name}`);
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
                  <h3 className="text-lg font-bold text-foreground">{client.plan_activo.name}</h3>
                  <div className="flex items-baseline gap-1 mt-1 text-2xl font-mono font-bold text-brand-400">
                    <span>${Number(client.plan_activo.price).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground font-normal font-sans">/mes</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50 font-mono text-muted-foreground">
                  <div>Bajada: <span className="text-foreground font-semibold">{client.plan_activo.speed_down_mbps} Mbps</span></div>
                  <div>Subida: <span className="text-foreground font-semibold">{client.plan_activo.speed_up_mbps} Mbps</span></div>
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

            {client.latitude && client.longitude ? (
              <div className="space-y-3">
                <div className="rounded-lg overflow-hidden border border-border h-48">
                  <MapContainer
                    center={[client.latitude, client.longitude]}
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
                    <Marker position={[client.latitude, client.longitude]} icon={customMarkerIcon} />
                  </MapContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground text-center">
                  <div className="bg-secondary/40 p-1.5 rounded">Lat: {client.latitude}</div>
                  <div className="bg-secondary/40 p-1.5 rounded">Lng: {client.longitude}</div>
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
                    <option key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</option>
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
                  title: ticketTitle,
                  description: ticketDesc,
                  priority: ticketPriority
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
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
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
          queryClient.invalidateQueries({ queryKey: ['clients'] })
          queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
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
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              Esta acción es <strong>irreversible</strong> y eliminará al cliente <strong>{client.name}</strong> de la base de datos de manera permanente, junto con todo su historial.
            </p>
            {deleteError && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 mb-4">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive leading-snug">{deleteError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmDeleteOpen(false); setDeleteError(null) }}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                type="button"
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

      {/* Modal Confirmar Cancelación de Suspensión Programada */}
      {confirmCancelDeferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            <div className="flex items-center gap-2.5 text-amber-400 mb-3">
              <CalendarClock className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Cancelar la suspensión programada?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              El cliente <strong>{client.name}</strong> permanecerá activo, sin una fecha de suspensión pendiente.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancelDeferOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelDeferMutation.mutate(undefined, { onSuccess: () => setConfirmCancelDeferOpen(false) })
                }}
                disabled={cancelDeferMutation.isPending}
                className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
              >
                {cancelDeferMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {cancelDeferMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Cancelación de Reactivación Programada */}
      {confirmCancelReactivationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            <div className="flex items-center gap-2.5 text-amber-400 mb-3">
              <CalendarClock className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Cancelar la reactivación programada?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              El cliente <strong>{client.name}</strong> permanecerá suspendido indefinidamente, sin una fecha de reactivación pendiente.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmCancelReactivationOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelScheduledReactivationMutation.mutate(undefined, { onSuccess: () => setConfirmCancelReactivationOpen(false) })
                }}
                disabled={cancelScheduledReactivationMutation.isPending}
                className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
              >
                {cancelScheduledReactivationMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {cancelScheduledReactivationMutation.isPending ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Desconexión de Sesión PPPoE */}
      {confirmDisconnectSessionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in border border-rose-500/20">
            <div className="flex items-center gap-2.5 text-rose-400 mb-3">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-semibold">¿Desconectar sesión activa?</h3>
            </div>
            <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
              Se cerrará la sesión PPPoE activa de <strong>{client.pppoe_secret?.ppp_username}</strong>. El cliente podrá reconectarse automáticamente si su equipo sigue configurado.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDisconnectSessionOpen(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => {
                  disconnectSessionMutation.mutate(undefined, { onSuccess: () => setConfirmDisconnectSessionOpen(false) })
                }}
                disabled={disconnectSessionMutation.isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {disconnectSessionMutation.isPending ? 'Desconectando...' : 'Sí, desconectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Suspender Servicio */}
      {suspendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-rose-500/20">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5 text-rose-400">
                <Ban className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Suspender Servicio</h2>
              </div>
              <button
                type="button"
                onClick={() => setSuspendOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selector de duración */}
            <div className="flex gap-1 p-4 pb-0">
              <button
                type="button"
                onClick={() => setSuspendUntilMode('indefinido')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  suspendUntilMode === 'indefinido'
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                    : 'bg-secondary/30 border-border/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Ban className="w-3.5 h-3.5" />
                Suspender
              </button>
              <button
                type="button"
                onClick={() => setSuspendUntilMode('hasta')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border transition-all ${
                  suspendUntilMode === 'hasta'
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                    : 'bg-secondary/30 border-border/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Suspender hasta
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!suspensionReason.trim()) return
                if (suspendUntilMode === 'hasta') {
                  if (!suspendUntilDate) return
                  suspendClientMutation.mutate({ reason: suspensionReason, reactivateAt: new Date(suspendUntilDate).toISOString() })
                } else {
                  suspendClientMutation.mutate({ reason: suspensionReason })
                }
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                {suspendUntilMode === 'hasta'
                  ? <>El servicio de <strong>{client.name}</strong> será suspendido inmediatamente y se reactivará automáticamente en la fecha indicada.</>
                  : <>El servicio de <strong>{client.name}</strong> será suspendido inmediatamente.</>
                }
              </p>

              {/* Fecha de reactivación (solo en modo "hasta") */}
              {suspendUntilMode === 'hasta' && (
                <div>
                  <label htmlFor="suspend-until-date" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Reactivar el
                  </label>
                  <input
                    id="suspend-until-date"
                    type="datetime-local"
                    value={suspendUntilDate}
                    onChange={(e) => setSuspendUntilDate(e.target.value)}
                    required
                    min={toDatetimeLocalValue(new Date(Date.now() + 60000))}
                    className="input-field font-mono cursor-pointer"
                  />
                </div>
              )}

              {/* Motivo */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Motivo
                </label>
                <select
                  value={suspensionReason}
                  onChange={(e) => setSuspensionReason(e.target.value)}
                  required
                  className="input-field cursor-pointer"
                >
                  <option value="">— Seleccione un motivo —</option>
                  {suspensionReasons.map((motivo) => (
                    <option key={motivo} value={motivo}>{motivo}</option>
                  ))}
                </select>
                {suspensionReasons.length === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    No hay motivos configurados. Ve a Ajustes → Facturación → Suspensión para agregarlos.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSuspendOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    suspendClientMutation.isPending ||
                    !suspensionReason.trim() ||
                    (suspendUntilMode === 'hasta' && !suspendUntilDate)
                  }
                  className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-rose-600 hover:bg-rose-700 text-white border border-rose-700"
                >
                  {suspendClientMutation.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {suspendClientMutation.isPending
                    ? 'Procesando...'
                    : suspendUntilMode === 'hasta' ? 'Suspender Hasta Fecha' : 'Suspender Ahora'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Aplazar Suspensión */}
      {deferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5 text-amber-400">
                <CalendarClock className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Aplazar Suspensión</h2>
              </div>
              <button
                type="button"
                onClick={() => setDeferOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!suspensionReason.trim() || !deferDate) return
                deferClientMutation.mutate({ deferUntil: new Date(deferDate).toISOString(), reason: suspensionReason })
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                El servicio de <strong>{client.name}</strong> permanecerá activo hasta la fecha seleccionada, momento en que se suspenderá automáticamente.
              </p>

              {/* Fecha de aplazamiento */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Aplazar hasta
                </label>
                <input
                  type="datetime-local"
                  value={deferDate}
                  onChange={(e) => setDeferDate(e.target.value)}
                  required
                  min={toDatetimeLocalValue(new Date(Date.now() + 60000))}
                  className="input-field font-mono cursor-pointer"
                />
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Motivo
                </label>
                <select
                  value={suspensionReason}
                  onChange={(e) => setSuspensionReason(e.target.value)}
                  required
                  className="input-field cursor-pointer"
                >
                  <option value="">— Seleccione un motivo —</option>
                  {suspensionReasons.map((motivo) => (
                    <option key={motivo} value={motivo}>{motivo}</option>
                  ))}
                </select>
                {suspensionReasons.length === 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    No hay motivos configurados. Ve a Ajustes → Facturación → Suspensión para agregarlos.
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeferOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deferClientMutation.isPending || !suspensionReason.trim() || !deferDate}
                  className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
                >
                  {deferClientMutation.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {deferClientMutation.isPending ? 'Procesando...' : 'Programar Suspensión'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Aplazar Reactivación (cliente ya suspendido) */}
      {deferReactivationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in border border-amber-500/20">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5 text-amber-400">
                <CalendarClock className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Aplazar Reactivación</h2>
              </div>
              <button
                type="button"
                onClick={() => setDeferReactivationOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!deferReactivationDate) return
                deferReactivationMutation.mutate(new Date(deferReactivationDate).toISOString())
              }}
              className="p-5 space-y-4"
            >
              <p className="text-muted-foreground text-xs leading-relaxed">
                El servicio de <strong>{client.name}</strong> permanecerá suspendido y se reactivará automáticamente en la fecha indicada.
              </p>

              {/* Fecha de reactivación */}
              <div>
                <label htmlFor="defer-reactivation-date" className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Reactivar el
                </label>
                <input
                  id="defer-reactivation-date"
                  type="datetime-local"
                  value={deferReactivationDate}
                  onChange={(e) => setDeferReactivationDate(e.target.value)}
                  required
                  min={toDatetimeLocalValue(new Date(Date.now() + 60000))}
                  className="input-field font-mono cursor-pointer"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeferReactivationOpen(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deferReactivationMutation.isPending || !deferReactivationDate}
                  className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-400"
                >
                  {deferReactivationMutation.isPending && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {deferReactivationMutation.isPending ? 'Procesando...' : 'Programar Reactivación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Pago */}
      <PaymentRegisterDialog
        isOpen={selectedInvoice !== null}
        onClose={() => setSelectedInvoice(null)}
        invoice={selectedInvoice}
        onSuccess={() => {
          refetch()
          queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
          queryClient.invalidateQueries({ queryKey: ['client-payments', id] })
        }}
      />

      {/* Modal Crear Factura Manual */}
      <InvoiceCreateDialog
        isOpen={manualInvoiceOpen}
        onClose={() => setManualInvoiceOpen(false)}
        preselectedClientId={client.id}
        preselectedClientName={client.name}
        preselectedClientCedula={client.cedula}
        onSuccess={() => {
          refetch()
          queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
        }}
      />

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}
