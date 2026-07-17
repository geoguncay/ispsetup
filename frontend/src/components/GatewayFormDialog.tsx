/**
 * GatewayFormDialog — Modal para crear y editar gateways con test de conexión y mapa interactivo.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, CheckCircle2, XCircle, Plug, Eye, EyeOff, Trash2, MapPin, Server, Key, Plus } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'

// Icono personalizado SVG de Leaflet para evitar problemas de rutas de Vite (Color Violeta para Gateways)
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

const gatewaySchema = z.object({
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
  parent_queue: z.string().max(100).optional().nullable(),
  address_list: z.string().max(100).optional().nullable(),
  suspend_list: z.string().max(100).optional().nullable(),
  config_mode: z.enum(['system', 'gateway']).default('system'),
  bandwidth_up: z.coerce.number().min(0).default(0),
  bandwidth_down: z.coerce.number().min(0).default(0),
  site_id: z.string().optional().nullable(),
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

type GatewayFormData = z.infer<typeof gatewaySchema>

interface Site {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
}

interface GatewayFormDialogProps {
  open: boolean
  onClose: () => void
  gateway?: {
    id: string;
    name: string;
    ip: string;
    api_port: number;
    api_username: string;
    hw_model: string | null;
    notes: string | null;
    status?: 'online' | 'offline' | 'degraded' | 'unknown' | null;
    latitude?: number | null;
    longitude?: number | null;
    traffic_monitoring?: boolean;
    speed_control?: boolean;
    sync_logs?: boolean;
    alert_notifications?: boolean;
    parent_queue?: string | null;
    address_list?: string | null;
    suspend_list?: string | null;
    config_mode?: string | null;
    bandwidth_up?: number | null;
    bandwidth_down?: number | null;
    site_id?: string | null;
    site_name?: string | null;
  } | null
  onSuccess: (savedGateway: { id: string }) => void
  onDelete?: (id: string) => void
}

interface TestResult {
  success: boolean
  message: string
  ros_version?: string
  uptime?: string
  error?: string
}

export function GatewayFormDialog({ open, onClose, gateway, onSuccess, onDelete }: GatewayFormDialogProps) {
  const isEdit = !!gateway
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

  // Map fly-to target (separate from gateway coords)
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

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    watch,
    trigger,
    formState: { errors },
  } = useForm<GatewayFormData>({
    resolver: zodResolver(gatewaySchema) as unknown as Resolver<GatewayFormData>,
    defaultValues: {
      api_port: 8728,
      traffic_monitoring: true,
      speed_control: true,
      sync_logs: true,
      alert_notifications: true,
      bandwidth_up: 0,
      bandwidth_down: 0,
      parent_queue: '',
      address_list: '',
      suspend_list: '',
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
      if (gateway) {
        const mode = (gateway.config_mode === 'gateway' ? 'gateway' : 'system') as 'system' | 'gateway'
        reset({
          id: gateway.id,
          name: gateway.name,
          ip: gateway.ip,
          api_port: gateway.api_port,
          api_username: gateway.api_username,
          password_api: '',
          hw_model: gateway.hw_model ?? '',
          notes: gateway.notes ?? '',
          latitude: gateway.latitude ?? null,
          longitude: gateway.longitude ?? null,
          traffic_monitoring: gateway.traffic_monitoring ?? true,
          speed_control: gateway.speed_control ?? true,
          sync_logs: gateway.sync_logs ?? true,
          alert_notifications: gateway.alert_notifications ?? true,
          parent_queue: gateway.parent_queue ?? '',
          address_list: gateway.address_list ?? '',
          suspend_list: gateway.suspend_list ?? '',
          config_mode: mode,
          bandwidth_up: gateway.bandwidth_up ?? 0,
          bandwidth_down: gateway.bandwidth_down ?? 0,
          site_id: gateway.site_id ?? null,
        })
        resetSiteState(gateway.site_id ?? '')
      } else {
        const savedPort = localStorage.getItem('isp_default_api_port')
        const savedUsername = localStorage.getItem('isp_default_api_username')
        const savedPassword = localStorage.getItem('isp_default_password_api')
        const savedAddressList = localStorage.getItem('isp_default_address_list')
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
          bandwidth_up: 0,
          bandwidth_down: 0,
          parent_queue: '',
          address_list: savedAddressList || '',
          config_mode: 'system',
          site_id: null,
        })
        resetSiteState()
        handleGetLocation()
      }
    }
  }, [open, gateway, reset, setValue, handleGetLocation])

  // Preseleccionar la primera cola padre y address list disponible al crear un nuevo gateway
  const nameVal = watch('name')

  useEffect(() => {
    if (!isEdit && nameVal) {
      const savedParentQueues = localStorage.getItem('isp_parent_queues')
      const parentQueues: string[] = savedParentQueues ? JSON.parse(savedParentQueues) : []
      if (parentQueues.length > 0) {
        setValue('parent_queue', parentQueues[0])
      }

      const savedAddressLists = localStorage.getItem('isp_address_lists')
      const addressLists: string[] = savedAddressLists ? JSON.parse(savedAddressLists) : []
      if (addressLists.length > 0) {
        setValue('address_list', addressLists[0])
      }
    }
  }, [nameVal, isEdit, setValue])

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
    mutationFn: async (data: GatewayFormData) => {
      const payload: any = { ...data }
      delete payload.id
      if (isEdit && !payload.password_api) {
        delete payload.password_api
      }
      if (!payload.latitude || isNaN(Number(payload.latitude))) payload.latitude = null
      if (!payload.longitude || isNaN(Number(payload.longitude))) payload.longitude = null
      if (!payload.site_id) payload.site_id = null
      if (!isEdit) {
        payload.parent_queue = null
        payload.address_list = null
        payload.suspend_list = null
        payload.config_mode = 'system'
        payload.bandwidth_up = 0
        payload.bandwidth_down = 0
      }

      if (isEdit) {
        const { data: savedGateway } = await api.put(`/gateways/${gateway!.id}`, payload)
        return savedGateway as { id: string }
      } else {
        const { data: savedGateway } = await api.post('/gateways', payload)
        return savedGateway as { id: string }
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
      gateway_id: gateway?.id || undefined,
    }

    try {
      const { data } = await api.post('/gateways/test-connection', testPayload)
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

  // Componente interno para sincronizar la vista del mapa con coordenadas del gateway
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-6xl mx-4 animate-fade-in h-5/6 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isEdit ? `Editar: ${gateway!.name}` : 'Agregar Gateway'}
            </h2>
          </div>
          <button
            id="close-gateway-dialog"
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
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === 'info'
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Server className="w-4 h-4" />
              Información y Ubicación
            </button>
              <button
              type="button"
              onClick={() => setTab('credentials')}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === 'credentials'
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Key className="w-4 h-4" />
              Credenciales API y Prueba de Conexión
            </button>
          </div>
        </div>

        {/* Form */}
        <form
          id="gateway-form"
          onSubmit={handleSubmit((data) => saveMutation.mutate(data), onFormError)}
          className="flex flex-col flex-1 min-h-0"
        >
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* TAB: CREDENCIALES Y TEST */}
          {tab === 'credentials' && (
            <div className="max-w-2xl mx-auto py-4 space-y-4 animate-fade-in">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <Key className="w-4 h-4" /> Parámetros de Red y API MikroTik
              </div>

              <div className="glass-card p-6 border border-border/60 space-y-4 bg-secondary/10">
                {/* IP y puerto */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Dirección IP / Host *
                    </label>
                    <input
                      id="gateway-ip"
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
                      id="gateway-port"
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
                      id="gateway-user"
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
                        id="gateway-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        {...register('password_api')}
                        className="input-field pr-11"
                      />
                      <button
                        type="button"
                        id="toggle-gateway-password-visibility"
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
                <div className="flex items-center justify-between">
                  <div>
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
                    className="btn-primary text-xs py-1.5 px-4 shrink-0"
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

          {/* TAB: INFORMACIÓN Y UBICACIÓN */}
          {tab === 'info' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
              {/* Columna Izquierda: Formulario */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                  <Server className="w-4 h-4" /> Especificaciones del Gateway
                </div>

                {/* Nombre */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Nombre del gateway *
                  </label>
                  <input
                    id="gateway-name"
                    type="text"
                    placeholder="Gateway Principal"
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
                    id="gateway-model"
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
                      id="gateway-site"
                      aria-label="Sitio o ubicación del gateway"
                      title="Sitio o ubicación del gateway"
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

                {/* Coordenadas GPS del gateway (Inputs manuales) */}
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
                    id="gateway-notes"
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
                    Marcar ubicación del Gateway en el mapa
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
                    onDelete?.(gateway!.id)
                  }}
                  className="btn-destructive px-4 justify-center flex items-center gap-1.5"
                  title="Eliminar gateway"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Eliminar</span>
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                id="cancel-gateway-form"
                onClick={onClose}
                className="btn-secondary w-32 justify-center"
              >
                Cancelar
              </button>

              <button
                type="submit"
                id="save-gateway-btn"
                disabled={saveMutation.isPending}
                className="btn-primary w-44 justify-center"
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {saveMutation.isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar gateway'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
