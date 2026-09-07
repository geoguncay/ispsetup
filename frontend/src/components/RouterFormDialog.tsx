/**
 * RouterFormDialog — Modal para crear y editar routers con test de conexión y mapa interactivo.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, CheckCircle2, XCircle, Plug, Eye, EyeOff, Trash2, MapPin, Server, Key, Plus, Network } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { getZeroTierSettings, getZeroTierMembers } from '@/services/zerotier'

// Icono personalizado SVG de Leaflet para evitar problemas de rutas de Vite (Color Violeta para Routers)
const markerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238b5cf6" width="36" height="36">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const customMarkerIcon = L.icon({
  iconUrl: markerSvg,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
})

// Centrado por defecto en Quito, Ecuador
const DEFAULT_CENTER: [number, number] = [-0.180653, -78.467834]

const routerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  ip: z.string().min(7, 'IP inválida').max(45),
  api_port: z.coerce.number().min(1).max(65535),
  api_username: z.string().min(1, 'Requerido').max(120),
  password_api: z.string().optional(),
  hw_model: z.string().max(120).optional(),
  notes: z.string().optional(),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  traffic_monitoring: z.boolean().default(true),
  speed_control: z.boolean().default(true),
  sync_logs: z.boolean().default(true),
  alert_notifications: z.boolean().default(true),
  site_id: z.string().optional().nullable(),
  zerotier_node_id: z.string().optional().nullable(),
}).refine(
  (data) => {
    if (!data.id && (!data.password_api || data.password_api.trim() === '')) {
      return false
    }
    return true
  },
  {
    message: 'Requerido',
    path: ['password_api'],
  }
)

type RouterFormData = z.infer<typeof routerSchema>

interface Site {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
}

interface RouterFormDialogProps {
  open: boolean
  onClose: () => void
  router?: {
    id: string;
    name: string;
    ip: string;
    api_port: number;
    api_username: string;
    hw_model: string | null;
    notes: string | null;
    status?: 'online' | 'offline' | 'tunnel_down' | 'degraded' | 'unknown' | null;
    latitude?: number | null;
    longitude?: number | null;
    traffic_monitoring?: boolean;
    speed_control?: boolean;
    sync_logs?: boolean;
    alert_notifications?: boolean;
    site_id?: string | null;
    site_name?: string | null;
    zerotier_node_id?: string | null;
  } | null
  onSuccess: (savedRouter: { id: string }) => void
  onDelete?: (id: string) => void
}

interface TestResult {
  success: boolean
  message: string
  ros_version?: string
  uptime?: string
  error?: string
}

export function RouterFormDialog({ open, onClose, router, onSuccess, onDelete }: RouterFormDialogProps) {
  const isEdit = !!router
  const queryClient = useQueryClient()
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [tab, setTab] = useState<'info' | 'credentials'>('info')

  // Site selector state
  const [siteSelectorValue, setSiteSelectorValue] = useState<string>('')
  const [siteMode, setSiteMode] = useState<'normal' | 'create'>('normal')
  const [siteInput, setSiteInput] = useState('')
  const [siteInputLat, setSiteInputLat] = useState('')
  const [siteInputLng, setSiteInputLng] = useState('')
  const [siteError, setSiteError] = useState<string | null>(null)

  // Map fly-to target (separate from router coords)
  const [mapFlyTarget, setMapFlyTarget] = useState<[number, number] | null>(null)

  // Consultar lista de Sitios
  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['sites-list'],
    queryFn: async () => {
      const { data } = await api.get('/sites')
      return data
    },
    enabled: open,
  })

  // ZeroTier: solo se consulta si la integración está configurada
  const { data: ztSettings } = useQuery({
    queryKey: ['zerotier-settings'],
    queryFn: getZeroTierSettings,
    enabled: open,
  })
  const ztConfigured = Boolean(ztSettings?.zt_network_id && ztSettings?.zt_api_token_set)

  const { data: ztMembers = [], isLoading: isLoadingZtMembers } = useQuery({
    queryKey: ['zerotier-members'],
    queryFn: getZeroTierMembers,
    enabled: open && ztConfigured,
  })

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    watch,
    trigger,
    formState: { errors },
  } = useForm<RouterFormData>({
    resolver: zodResolver(routerSchema) as unknown as Resolver<RouterFormData>,
    defaultValues: {
      api_port: 8728,
      traffic_monitoring: true,
      speed_control: true,
      sync_logs: true,
      alert_notifications: true,
    },
  })

  // Observar latitude y longitude en tiempo real para el marcador del mapa
  const latVal = watch('latitude')
  const lngVal = watch('longitude')

  const handleGetLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setValue('latitude', Number(position.coords.latitude.toFixed(6)))
          setValue('longitude', Number(position.coords.longitude.toFixed(6)))
        },
        (error) => {
          console.warn("Geolocation error:", error)
        },
        { enableHighAccuracy: true, timeout: 5000 }
      )
    }
  }, [setValue])

  const resetSiteState = (siteId: string = '') => {
    setSiteSelectorValue(siteId)
    setSiteMode('normal')
    setSiteInput('')
    setSiteInputLat('')
    setSiteInputLng('')
    setSiteError(null)
    setMapFlyTarget(null)
  }

  useEffect(() => {
    if (open) {
      setTab('info')
      setTestResult(null)
      setShowPassword(false)
      if (router) {
        reset({
          id: router.id,
          name: router.name,
          ip: router.ip,
          api_port: router.api_port,
          api_username: router.api_username,
          password_api: '',
          hw_model: router.hw_model ?? '',
          notes: router.notes ?? '',
          latitude: router.latitude ?? null,
          longitude: router.longitude ?? null,
          traffic_monitoring: router.traffic_monitoring ?? true,
          speed_control: router.speed_control ?? true,
          sync_logs: router.sync_logs ?? true,
          alert_notifications: router.alert_notifications ?? true,
          site_id: router.site_id ?? null,
          zerotier_node_id: router.zerotier_node_id ?? null,
        })
        resetSiteState(router.site_id ?? '')
      } else {
        const savedPort = localStorage.getItem('isp_default_api_port')
        const savedUsername = localStorage.getItem('isp_default_api_username')
        const savedPassword = localStorage.getItem('isp_default_password_api')
        const savedMonitoring = localStorage.getItem('isp_default_traffic_monitoring')
        const savedSpeedControl = localStorage.getItem('isp_default_speed_control')

        reset({
          id: undefined,
          api_port: savedPort ? parseInt(savedPort) : 8728,
          name: '',
          ip: '',
          api_username: savedUsername || '',
          password_api: savedPassword || '',
          latitude: null,
          longitude: null,
          traffic_monitoring: savedMonitoring !== null ? savedMonitoring === 'true' : true,
          speed_control: savedSpeedControl !== null ? savedSpeedControl === 'true' : true,
          sync_logs: true,
          alert_notifications: true,
          site_id: null,
          zerotier_node_id: null,
        })
        resetSiteState()
        handleGetLocation()
      }
    }
  }, [open, router, reset, setValue, handleGetLocation])

  // Site mutations
  const createSiteMutation = useMutation({
    mutationFn: async (payload: { name: string; latitude?: number | null; longitude?: number | null }) => {
      const { data } = await api.post('/sites', payload)
      return data as Site
    },
    onSuccess: (newSite) => {
      queryClient.invalidateQueries({ queryKey: ['sites-list'] })
      setSiteSelectorValue(newSite.id)
      setValue('site_id', newSite.id)
      setSiteMode('normal')
      setSiteInput('')
      setSiteInputLat('')
      setSiteInputLng('')
      setSiteError(null)
      if (newSite.latitude && newSite.longitude) {
        setMapFlyTarget([newSite.latitude, newSite.longitude])
      }
    },
    onError: (err: any) => {
      setSiteError(err.response?.data?.detail ?? 'Error al crear el sitio')
    },
  })

  const handleSiteSelectChange = (val: string) => {
    setSiteError(null)
    if (val === '__new__') {
      setSiteSelectorValue('__new__')
      setSiteMode('create')
      setSiteInput('')
      setSiteInputLat(latVal ? String(latVal) : '')
      setSiteInputLng(lngVal ? String(lngVal) : '')
      setValue('site_id', null)
    } else {
      setSiteSelectorValue(val)
      setSiteMode('normal')
      setValue('site_id', val || null)
      if (val) {
        const site = sites.find(s => s.id === val)
        if (site?.latitude && site?.longitude) {
          setValue('latitude', site.latitude)
          setValue('longitude', site.longitude)
          setMapFlyTarget([site.latitude, site.longitude])
        }
      }
    }
  }

  const handleCreateSite = () => {
    if (!siteInput.trim()) return
    createSiteMutation.mutate({
      name: siteInput.trim(),
      latitude: siteInputLat ? parseFloat(siteInputLat) : null,
      longitude: siteInputLng ? parseFloat(siteInputLng) : null,
    })
  }

  const saveMutation = useMutation({
    mutationFn: async (data: RouterFormData) => {
      const payload: any = { ...data }
      delete payload.id
      if (isEdit && !payload.password_api) {
        delete payload.password_api
      }
      if (!payload.latitude || isNaN(Number(payload.latitude))) payload.latitude = null
      if (!payload.longitude || isNaN(Number(payload.longitude))) payload.longitude = null
      if (!payload.site_id) payload.site_id = null
      if (isEdit) {
        const { data: savedRouter } = await api.put(`/routers/${router!.id}`, payload)
        return savedRouter as { id: string }
      } else {
        const { data: savedRouter } = await api.post('/routers', payload)
        return savedRouter as { id: string }
      }
    },
    onSuccess,
  })

  const handleTest = async () => {
    const isValid = await trigger(['ip', 'api_port', 'api_username', 'password_api'])
    if (!isValid) return

    setIsTesting(true)
    setTestResult(null)

    const formValues = getValues()
    const testPayload = {
      ip: formValues.ip,
      api_port: formValues.api_port,
      api_username: formValues.api_username,
      password_api: formValues.password_api || undefined,
      router_id: router?.id || undefined,
    }

    try {
      const { data } = await api.post('/routers/test-connection', testPayload)
      setTestResult(data)
    } catch (err) {
      const errorResponse = err as { response?: { data?: { detail?: string } } }
      const errMsg = errorResponse?.response?.data?.detail || 'Error al contactar el servidor'
      setTestResult({ success: false, message: errMsg, error: 'Error de red/servidor' })
    } finally {
      setIsTesting(false)
    }
  }

  // Componente interno para manejar los clicks en el mapa
  function MapEventsHandler() {
    useMapEvents({
      click(e) {
        setValue('latitude', Number(e.latlng.lat.toFixed(6)))
        setValue('longitude', Number(e.latlng.lng.toFixed(6)))
      },
    })
    return null
  }

  // Componente interno para sincronizar la vista del mapa con coordenadas del router
  // y hacer fly-to cuando se selecciona un sitio con coordenadas
  function MapController({ center, flyTarget }: { center: [number, number]; flyTarget: [number, number] | null }) {
    const map = useMap()
    const lastFlyKey = useRef('')

    useEffect(() => {
      if (center[0] !== DEFAULT_CENTER[0] || center[1] !== DEFAULT_CENTER[1]) {
        map.setView(center, map.getZoom())
      }
    }, [center, map])

    useEffect(() => {
      if (flyTarget) {
        const key = `${flyTarget[0].toFixed(6)},${flyTarget[1].toFixed(6)}`
        if (key !== lastFlyKey.current) {
          lastFlyKey.current = key
          map.flyTo(flyTarget, 14, { duration: 1.0 })
        }
      }
    }, [flyTarget, map])

    return null
  }

  const onFormError = (errors: Record<string, unknown>) => {
    const errorKeys = Object.keys(errors)
    if (errorKeys.includes('name')) {
      setTab('info')
      return
    }
    const credentialFields = ['ip', 'api_port', 'api_username', 'password_api']
    const hasCredentialError = errorKeys.some((key) => credentialFields.includes(key))
    if (hasCredentialError) {
      setTab('credentials')
      return
    }
  }

  if (!open) return null

  const mapCenter: [number, number] = latVal && lngVal ? [latVal, lngVal] : DEFAULT_CENTER

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-6xl mx-4 animate-fade-in h-5/6 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isEdit ? `Editar: ${router!.name}` : 'Agregar Router'}
            </h2>
          </div>
          <button
            id="close-router-dialog"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-border bg-secondary/10 shrink-0">
          <div className="flex overflow-x-auto">
            <button
              type="button"
              onClick={() => setTab('info')}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${tab === 'info'
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              <Server className="w-4 h-4" />
              Información
            </button>
            <button
              type="button"
              onClick={() => setTab('credentials')}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${tab === 'credentials'
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              <Key className="w-4 h-4" />
              Credenciales API
            </button>
          </div>
        </div>

        {/* Form */}
        <form
          id="router-form"
          onSubmit={handleSubmit((data) => saveMutation.mutate(data), onFormError)}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* TAB: INFORMACIÓN Y UBICACIÓN */}
            {tab === 'info' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
                {/* Columna Izquierda: Formulario */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                    <Server className="w-4 h-4" /> Especificaciones del Router
                  </div>

                  {/* Nombre */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Nombre del router *
                    </label>
                    <input
                      id="router-name"
                      type="text"
                      placeholder="Router Principal"
                      {...register('name')}
                      className="input-field"
                    />
                    {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
                  </div>
                  {/* Modelo HW (opcional) */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Modelo hardware
                    </label>
                    <input
                      id="router-model"
                      type="text"
                      placeholder="RB5009, RB4011iGS+, CCR2116, etc."
                      {...register('hw_model')}
                      className="input-field"
                    />
                  </div>
                  {/* Sitio / Ubicación */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                      Sitio / Ubicación
                    </label>

                    {/* Select row */}
                    <div className="flex gap-2">
                      <select
                        id="router-site"
                        aria-label="Sitio o ubicación del router"
                        title="Sitio o ubicación del router"
                        value={siteSelectorValue}
                        onChange={(e) => handleSiteSelectChange(e.target.value)}
                        className="input-field cursor-pointer font-medium flex-1"
                      >
                        <option value="">Sin Sitio (General)</option>
                        {sites.map((site) => (
                          <option key={site.id} value={site.id}>
                            {site.name}{site.latitude && site.longitude ? ' 📍' : ''}
                          </option>
                        ))}
                        <option value="__new__">+ Crear nuevo sitio...</option>
                      </select>
                    </div>

                    {/* Error de sitio */}
                    {siteError && (
                      <p className="text-xs text-destructive mt-1">{siteError}</p>
                    )}

                    {/* Panel: Crear nuevo sitio */}
                    {siteMode === 'create' && (
                      <div className="mt-2 p-3 border border-brand-500/30 bg-brand-500/5 rounded-lg space-y-2 animate-fade-in">
                        <p className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Nuevo sitio</p>
                        <div className="flex gap-2 items-center">
                          <input
                            autoFocus
                            type="text"
                            value={siteInput}
                            onChange={(e) => setSiteInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateSite() } }}
                            placeholder="Nombre del sitio (ej. Torre Norte)"
                            className="input-field flex-1 text-sm"
                          />
                          <button
                            type="button"
                            disabled={!siteInput.trim() || createSiteMutation.isPending}
                            onClick={handleCreateSite}
                            className="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                          >
                            {createSiteMutation.isPending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Plus className="w-3.5 h-3.5" />}
                            Agregar
                          </button>
                          <button
                            type="button"
                            onClick={() => { setSiteMode('normal'); setSiteSelectorValue(''); setValue('site_id', null); setSiteError(null) }}
                            className="p-2 hover:bg-secondary rounded-lg text-muted-foreground transition-colors shrink-0"
                            title="Cancelar"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {/* Coordenadas opcionales para el sitio */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-1">Latitud del sitio</label>
                            <input
                              type="number"
                              step="0.000001"
                              value={siteInputLat}
                              onChange={(e) => setSiteInputLat(e.target.value)}
                              placeholder="-0.180653"
                              className="input-field font-mono text-xs py-1.5"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-1">Longitud del sitio</label>
                            <input
                              type="number"
                              step="0.000001"
                              value={siteInputLng}
                              onChange={(e) => setSiteInputLng(e.target.value)}
                              placeholder="-78.467834"
                              className="input-field font-mono text-xs py-1.5"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Coordenadas GPS del router (Inputs manuales) */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Latitud</label>
                      <input
                        type="number"
                        step="0.000001"
                        placeholder="-0.180653"
                        {...register('latitude')}
                        className="input-field font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Longitud</label>
                      <input
                        type="number"
                        step="0.000001"
                        placeholder="-78.467834"
                        {...register('longitude')}
                        className="input-field font-mono"
                      />
                    </div>
                  </div>

                  {/* Notas (opcional) */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Notas
                    </label>
                    <textarea
                      id="router-notes"
                      rows={3}
                      placeholder="Ubicación, observaciones..."
                      {...register('notes')}
                      className="input-field resize-none"
                    />
                  </div>

                </div>

                {/* Columna Derecha: Mapa Interactivo */}
                <div className="flex flex-col h-full min-h-[350px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-brand-400" />
                      Marcar ubicación del Router en el mapa
                    </span>
                    <button
                      type="button"
                      onClick={handleGetLocation}
                      className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1 font-semibold"
                    >
                      <MapPin className="w-3.5 h-3.5 animate-pulse" />
                      Usar mi ubicación actual
                    </button>
                  </div>

                  <div className="flex-1 rounded-lg border border-border overflow-hidden min-h-[300px] lg:h-full relative">
                    <MapContainer
                      center={mapCenter}
                      zoom={12}
                      scrollWheelZoom={true}
                      style={{ height: '100%', width: '100%', minHeight: '300px', zIndex: 10 }}
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <MapEventsHandler />
                      <MapController center={mapCenter} flyTarget={mapFlyTarget} />
                      {latVal && lngVal && (
                        <Marker position={[latVal, lngVal]} icon={customMarkerIcon} />
                      )}
                    </MapContainer>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CREDENCIALES Y TEST */}
            {tab === 'credentials' && (
              <div className="max-w-2xl mx-auto py-4 space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                  <Key className="w-4 h-4" /> Parámetros de Red y API MikroTik
                </div>

                <div className="glass-card p-6 border border-border/60 space-y-4 bg-secondary/10">

                  {/* Vínculo con nodo ZeroTier (opcional) */}
                  {ztConfigured && (
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                        <Network className="w-3.5 h-3.5 text-brand-400" />
                        Vincular con ZeroTier
                      </label>
                      <select
                        id="router-zerotier-node"
                        aria-label="Nodo ZeroTier a vincular"
                        value={watch('zerotier_node_id') ?? ''}
                        onChange={(e) => {
                          const nodeId = e.target.value || null
                          setValue('zerotier_node_id', nodeId)
                          const member = ztMembers.find((m) => m.node_id === nodeId)
                          if (member?.ip_assignments?.[0]) {
                            setValue('ip', member.ip_assignments[0])
                          }
                        }}
                        disabled={isLoadingZtMembers}
                        className="input-field cursor-pointer font-sans text-sm"
                      >
                        <option value="">Sin vincular</option>
                        {ztMembers.map((m) => (
                          <option key={m.node_id} value={m.node_id}>
                            {(m.name || m.node_id)} — {m.ip_assignments[0] || 'sin IP'} {m.online ? '(en línea)' : '(fuera de línea)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* IP y puerto */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Dirección IP / Host *
                      </label>
                      <input
                        id="router-ip"
                        type="text"
                        placeholder="192.168.88.1"
                        {...register('ip')}
                        className="input-field font-mono"
                      />
                      {errors.ip && (
                        <p className="text-xs text-destructive mt-1">{errors.ip.message}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Puerto API *</label>
                      <input
                        id="router-port"
                        type="number"
                        {...register('api_port')}
                        className="input-field font-mono"
                      />
                      {errors.api_port && (
                        <p className="text-xs text-destructive mt-1">{errors.api_port.message}</p>
                      )}
                    </div>
                  </div>

                  {/* Usuario y contraseña */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Usuario API *
                      </label>
                      <input
                        id="router-user"
                        type="text"
                        placeholder="admin"
                        {...register('api_username')}
                        className="input-field"
                      />
                      {errors.api_username && (
                        <p className="text-xs text-destructive mt-1">{errors.api_username.message}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Contraseña API *{isEdit && <span className="text-muted-foreground text-xs"> (dejar vacío = no cambiar)</span>}
                      </label>
                      <div className="relative">
                        <input
                          id="router-password"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          {...register('password_api')}
                          className="input-field pr-11"
                        />
                        <button
                          type="button"
                          id="toggle-router-password-visibility"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {errors.password_api && (
                        <p className="text-xs text-destructive mt-1">{errors.password_api.message}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Panel de prueba de conexión */}
                <div className="border border-border rounded-xl p-5 space-y-4 bg-secondary/5">
                  <div className="grid sm:grid-cols-3 gap-4 items-center">
                    <div className="sm:col-span-2">
                      <h4 className="text-sm font-medium text-foreground">Prueba de conexión API</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Verifica que el puerto esté abierto y que las credenciales de acceso sean correctas.
                      </p>
                    </div>
                    <button
                      type="button"
                      id="test-connection-btn"
                      onClick={handleTest}
                      disabled={isTesting}
                      className="btn-primary text-xs py-1.5 px-4 shrink-0 justify-self-end"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plug className="w-3.5 h-3.5" />
                      )}
                      {isTesting ? 'Probando...' : 'Probar conexión'}
                    </button>
                  </div>

                  {testResult && (
                    <div
                      className={`rounded-lg p-4 flex items-start gap-3.5 ${testResult.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30'
                        : 'bg-destructive/10 border border-destructive/30'
                        }`}
                    >
                      {testResult.success ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                      )}
                      <div className="text-xs space-y-1.5 leading-relaxed">
                        <p className={`font-semibold ${testResult.success ? 'text-emerald-400' : 'text-destructive'}`}>
                          {testResult.message}
                        </p>
                        {testResult.ros_version && (
                          <div className="text-muted-foreground space-y-0.5">
                            <p><span className="font-semibold text-foreground">Versión RouterOS:</span> v{testResult.ros_version}</p>
                            <p><span className="font-semibold text-foreground">Tiempo encendido:</span> {testResult.uptime}</p>
                          </div>
                        )}
                        {testResult.error && (
                          <p className="text-muted-foreground font-mono bg-black/30 p-2 rounded border border-border/50 mt-1 max-w-full overflow-x-auto">
                            {testResult.error}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error de guardado */}
            {saveMutation.isError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
                <p className="text-sm text-destructive">
                  Error al guardar. Verifica los datos e intenta de nuevo.
                </p>
              </div>
            )}
          </div>

          {/* Acciones del Footer */}
          <div className="flex justify-between items-center border-t border-border/50 px-5 py-4 shrink-0">
            <div>
              {isEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onDelete?.(router!.id)
                  }}
                  className="btn-destructive px-4 justify-center flex items-center gap-1.5"
                  title="Eliminar router"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Eliminar</span>
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                id="save-router-btn"
                disabled={saveMutation.isPending}
                className="btn-primary w-44 justify-center"
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {saveMutation.isPending ? 'Guardando...' : isEdit ? 'Guardar' : 'Agregar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
