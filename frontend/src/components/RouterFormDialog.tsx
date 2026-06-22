/**
 * RouterFormDialog — Modal para crear y editar routers con test de conexión y mapa interactivo.
 */
import { useState, useEffect, useCallback } from 'react'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, CheckCircle2, XCircle, Plug, Eye, EyeOff, Trash2, MapPin, Server, Key, Activity, Check } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'

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
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  ip: z.string().min(7, 'IP inválida').max(45),
  puerto_api: z.coerce.number().min(1).max(65535),
  usuario_api: z.string().min(1, 'Requerido').max(120),
  password_api: z.string().optional(),
  modelo_hw: z.string().max(120).optional(),
  notas: z.string().optional(),
  latitud: z.coerce.number().optional().nullable(),
  longitud: z.coerce.number().optional().nullable(),
  monitoreo_trafico: z.boolean().default(true),
  control_velocidad: z.boolean().default(true),
  sincronizar_logs: z.boolean().default(true),
  notificaciones_alertas: z.boolean().default(true),
  cola_padre: z.string().max(100).optional().nullable(),
  address_list: z.string().max(100).optional().nullable(),
  ancho_banda_up: z.coerce.number().min(0).default(0),
  ancho_banda_down: z.coerce.number().min(0).default(0),
  site_id: z.string().optional().nullable(),
  new_site_nombre: z.string().max(120).optional().nullable(),
}).refine(
  (data) => {
    // La contraseña es obligatoria solo si es un router nuevo (no hay id)
    if (!data.id && (!data.password_api || data.password_api.trim() === '')) {
      return false
    }
    return true
  },
  {
    message: 'Requerido',
    path: ['password_api'],
  }
).refine(
  (data) => {
    // Si site_id es 'new', new_site_nombre es obligatorio
    if (data.site_id === 'new' && (!data.new_site_nombre || data.new_site_nombre.trim() === '')) {
      return false
    }
    return true
  },
  {
    message: 'Ingrese el nombre del nuevo sitio',
    path: ['new_site_nombre'],
  }
)

type RouterFormData = z.infer<typeof routerSchema>

interface RouterFormDialogProps {
  open: boolean
  onClose: () => void
  router?: {
    id: string;
    nombre: string;
    ip: string;
    puerto_api: number;
    usuario_api: string;
    modelo_hw: string | null;
    notas: string | null;
    status?: 'online' | 'offline' | 'degraded' | 'unknown' | null;
    latitud?: number | null;
    longitud?: number | null;
    monitoreo_trafico?: boolean;
    control_velocidad?: boolean;
    sincronizar_logs?: boolean;
    notificaciones_alertas?: boolean;
    cola_padre?: string | null;
    address_list?: string | null;
    ancho_banda_up?: number | null;
    ancho_banda_down?: number | null;
    site_id?: string | null;
    site_nombre?: string | null;
  } | null
  onSuccess: () => void
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
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  // Consultar lista de Sitios
  const { data: sites = [] } = useQuery<any[]>({
    queryKey: ['sites-list'],
    queryFn: async () => {
      const { data } = await api.get('/sites')
      return data
    },
    enabled: open,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)

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
      puerto_api: 8728,
      monitoreo_trafico: true,
      control_velocidad: true,
      sincronizar_logs: true,
      notificaciones_alertas: true,
      ancho_banda_up: 0,
      ancho_banda_down: 0,
      cola_padre: '',
      address_list: '',
    },
  })

  // Observar latitud y longitud en tiempo real para el marcador del mapa
  const latVal = watch('latitud')
  const lngVal = watch('longitud')

  const handleGetLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setValue('latitud', Number(position.coords.latitude.toFixed(6)))
          setValue('longitud', Number(position.coords.longitude.toFixed(6)))
        },
        (error) => {
          console.warn("Geolocation error:", error)
        },
        { enableHighAccuracy: true, timeout: 5000 }
      )
    }
  }, [setValue])

  useEffect(() => {
    if (open) {
      setStep(1)
      setTestResult(null)
      setShowPassword(false)
      if (router) {
        reset({
          id: router.id,
          nombre: router.nombre,
          ip: router.ip,
          puerto_api: router.puerto_api,
          usuario_api: router.usuario_api,
          password_api: '',
          modelo_hw: router.modelo_hw ?? '',
          notas: router.notas ?? '',
          latitud: router.latitud ?? null,
          longitud: router.longitud ?? null,
          monitoreo_trafico: router.monitoreo_trafico ?? true,
          control_velocidad: router.control_velocidad ?? true,
          sincronizar_logs: router.sincronizar_logs ?? true,
          notificaciones_alertas: router.notificaciones_alertas ?? true,
          cola_padre: router.cola_padre ?? '',
          address_list: router.address_list ?? '',
          ancho_banda_up: router.ancho_banda_up ?? 0,
          ancho_banda_down: router.ancho_banda_down ?? 0,
          site_id: router.site_id ?? '',
          new_site_nombre: '',
        })
      } else {
        reset({
          id: undefined,
          puerto_api: 8728,
          nombre: '',
          ip: '',
          usuario_api: '',
          password_api: '',
          latitud: null,
          longitud: null,
          monitoreo_trafico: true,
          control_velocidad: true,
          sincronizar_logs: true,
          notificaciones_alertas: true,
          ancho_banda_up: 0,
          ancho_banda_down: 0,
          cola_padre: '',
          address_list: '',
          site_id: '',
          new_site_nombre: '',
        })
        handleGetLocation()
      }
    }
  }, [open, router, reset, setValue, handleGetLocation])

  // Lógica reactiva: autocompletar cola padre y address list a partir del nombre del router
  const nombreVal = watch('nombre')
  const selectedSiteId = watch('site_id')
  
  useEffect(() => {
    if (!isEdit && nombreVal) {
      const limpio = nombreVal
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '')

      setValue('cola_padre', limpio ? `isp_padre_${limpio}` : '')
      setValue('address_list', limpio ? `isp_clientes_${limpio}` : '')
    }
  }, [nombreVal, isEdit, setValue])

  const saveMutation = useMutation({
    mutationFn: async (data: RouterFormData) => {
      const payload = { ...data }
      delete payload.id
      if (isEdit && !payload.password_api) {
        delete payload.password_api
      }
      if (payload.latitud === 0 || isNaN(Number(payload.latitud))) payload.latitud = null
      if (payload.longitud === 0 || isNaN(Number(payload.longitud))) payload.longitud = null

      // Saneamiento de campos de Sitios
      if (payload.site_id === 'new') {
        payload.site_id = null
      } else {
        payload.new_site_nombre = null
      }
      if (payload.site_id === '') {
        payload.site_id = null
      }

      if (isEdit) {
        await api.put(`/routers/${router!.id}`, payload)
      } else {
        await api.post('/routers', payload)
      }
    },
    onSuccess,
  })

  const handleTest = async () => {
    // Validamos únicamente los campos requeridos para la prueba de conexión
    const isValid = await trigger(['ip', 'puerto_api', 'usuario_api', 'password_api'])
    if (!isValid) return

    setIsTesting(true)
    setTestResult(null)

    const formValues = getValues()
    const testPayload = {
      ip: formValues.ip,
      puerto_api: formValues.puerto_api,
      usuario_api: formValues.usuario_api,
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
        setValue('latitud', Number(e.latlng.lat.toFixed(6)))
        setValue('longitud', Number(e.latlng.lng.toFixed(6)))
      },
    })
    return null
  }

  // Componente interno para sincronizar la vista del mapa cuando cambian las coordenadas
  function MapController({ center }: { center: [number, number] }) {
    const map = useMap()
    useEffect(() => {
      if (center && center[0] !== DEFAULT_CENTER[0] && center[1] !== DEFAULT_CENTER[1]) {
        map.setView(center, map.getZoom())
      }
    }, [center, map])
    return null
  }

  const onFormError = (errors: Record<string, unknown>) => {
    const errorKeys = Object.keys(errors)
    if (errorKeys.includes('nombre')) {
      setStep(1)
      return
    }
    const step2Fields = ['ip', 'puerto_api', 'usuario_api', 'password_api']
    const hasStep2Error = errorKeys.some((key) => step2Fields.includes(key))
    if (hasStep2Error) {
      setStep(2)
      return
    }
  }

  if (!open) return null

  // Coordenadas iniciales para render del Marker
  const mapCenter: [number, number] = latVal && lngVal ? [latVal, lngVal] : DEFAULT_CENTER



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-6xl mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isEdit ? `Editar: ${router!.nombre}` : 'Agregar router'}
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

        {/* Stepper */}
        <div className="px-6 py-4 bg-secondary/20 border-b border-border/50">
          <div className="flex items-center w-full max-w-3xl mx-auto justify-between relative">
            {/* Línea de fondo */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-border -translate-y-1/2 z-0" />
            <div
              className="absolute top-5 left-0 h-0.5 bg-brand-500 transition-all duration-300 -translate-y-1/2 z-0"
              style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}
            />

            {/* Paso 1 */}
            <button
              type="button"
              onClick={() => setStep(1)}
              className="relative z-10 flex flex-col items-center group cursor-pointer focus:outline-none"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${step >= 1
                ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20'
                : 'bg-secondary border-border text-muted-foreground'
                }`}>
                {step > 1 ? <Check className="w-5 h-5" /> : <Server className="w-5 h-5" />}
              </div>
              <span className={`text-[11px] font-semibold mt-1.5 transition-colors ${step === 1 ? 'text-brand-400 font-bold' : 'text-muted-foreground'
                }`}>
                1. Información y Ubicación
              </span>
            </button>

            {/* Paso 2 */}
            <button
              type="button"
              onClick={() => setStep(2)}
              className="relative z-10 flex flex-col items-center group cursor-pointer focus:outline-none"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${step >= 2
                ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20'
                : 'bg-secondary border-border text-muted-foreground'
                }`}>
                {step > 2 ? <Check className="w-5 h-5" /> : <Key className="w-5 h-5" />}
              </div>
              <span className={`text-[11px] font-semibold mt-1.5 transition-colors ${step === 2 ? 'text-brand-400 font-bold' : 'text-muted-foreground'
                }`}>
                2. Credenciales y Test
              </span>
            </button>

            {/* Paso 3 */}
            <button
              type="button"
              onClick={() => setStep(3)}
              className="relative z-10 flex flex-col items-center group cursor-pointer focus:outline-none"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${step === 3
                ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20'
                : 'bg-secondary border-border text-muted-foreground'
                }`}>
                <Activity className="w-5 h-5" />
              </div>
              <span className={`text-[11px] font-semibold mt-1.5 transition-colors ${step === 3 ? 'text-brand-400 font-bold' : 'text-muted-foreground'
                }`}>
                3. Servicios y Monitoreo
              </span>
            </button>
          </div>
        </div>

        {/* Form */}
        <form
          id="router-form"
          onSubmit={handleSubmit((data) => saveMutation.mutate(data), onFormError)}
          className="p-5 space-y-4"
        >
          {/* PASO 1: INFORMACIÓN Y UBICACIÓN */}
          {step === 1 && (
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
                    id="router-nombre"
                    type="text"
                    placeholder="Router Principal Quito"
                    {...register('nombre')}
                    className="input-field"
                  />
                  {errors.nombre && <p className="text-xs text-destructive mt-1">{errors.nombre.message}</p>}
                </div>

                {/* Sitio / Ubicación */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Sitio / Ubicación
                  </label>
                  <select
                    id="router-site"
                    {...register('site_id')}
                    className="input-field cursor-pointer font-medium"
                  >
                    <option value="">Sin Sitio (General)</option>
                    {sites.map((site: any) => (
                      <option key={site.id} value={site.id}>
                        {site.nombre}
                      </option>
                    ))}
                    <option value="new">+ Crear nuevo sitio...</option>
                  </select>
                </div>

                {/* Nuevo Sitio Campo de texto (Condicional) */}
                {selectedSiteId === 'new' && (
                  <div className="animate-fade-in space-y-1">
                    <label className="block text-xs font-semibold text-brand-400">
                      Nombre del nuevo sitio *
                    </label>
                    <input
                      id="router-new-site"
                      type="text"
                      placeholder="Ej. Torre Central, Nodo Norte"
                      {...register('new_site_nombre')}
                      className="input-field"
                    />
                    {errors.new_site_nombre && (
                      <p className="text-xs text-destructive mt-1">
                        {errors.new_site_nombre.message}
                      </p>
                    )}
                  </div>
                )}

                {/* Modelo HW (opcional) */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Modelo hardware <span className="text-muted-foreground text-xs">(opcional)</span>
                  </label>
                  <input
                    id="router-model"
                    type="text"
                    placeholder="RB5009, RB4011iGS+, CCR2116, etc."
                    {...register('modelo_hw')}
                    className="input-field"
                  />
                </div>

                {/* Coordenadas GPS (Inputs manuales) */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Latitud</label>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="-0.180653"
                      {...register('latitud')}
                      className="input-field font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Longitud</label>
                    <input
                      type="number"
                      step="0.000001"
                      placeholder="-78.467834"
                      {...register('longitud')}
                      className="input-field font-mono"
                    />
                  </div>
                </div>

                {/* Notas (opcional) */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Notas <span className="text-muted-foreground text-xs">(opcional)</span>
                  </label>
                  <textarea
                    id="router-notas"
                    rows={3}
                    placeholder="Ubicación, observaciones..."
                    {...register('notas')}
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
                    <MapController center={mapCenter} />
                    {latVal && lngVal && (
                      <Marker position={[latVal, lngVal]} icon={customMarkerIcon} />
                    )}
                  </MapContainer>
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: CREDENCIALES Y TEST */}
          {step === 2 && (
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
                      {...register('puerto_api')}
                      className="input-field font-mono"
                    />
                    {errors.puerto_api && (
                      <p className="text-xs text-destructive mt-1">{errors.puerto_api.message}</p>
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
                      {...register('usuario_api')}
                      className="input-field"
                    />
                    {errors.usuario_api && (
                      <p className="text-xs text-destructive mt-1">{errors.usuario_api.message}</p>
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

          {/* PASO 3: SERVICIOS Y MONITOREO */}
          {step === 3 && (
            <div className="space-y-6 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 flex gap-3.5 items-start">
                <div className="p-2 bg-brand-500/20 text-brand-400 rounded-lg shrink-0">
                  <Activity className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-brand-300">Configuración de Servicios del Router</h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Habilite o deshabilite las funciones y herramientas de control automatizadas para este router.
                    Los servicios configurados se ejecutarán en segundo plano de manera periódica.
                  </p>
                </div>
              </div>


              {/* MikroTik: Ancho de Banda y Recursos */}
              <div className="glass-card p-6 border border-border/60 space-y-5 bg-secondary/10">
                <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                  <Server className="w-4 h-4" /> Recursos y Ancho de Banda (MikroTik)
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                  {/* Ancho de Banda de Bajada */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Límite de Bajada de la Cola Padre (Mbps)
                    </label>
                    <input
                      type="number"
                      placeholder="Ej. 100 (0 = ilimitado)"
                      {...register('ancho_banda_down')}
                      className="input-field font-mono"
                    />
                    {errors.ancho_banda_down && <p className="text-xs text-destructive mt-1">{errors.ancho_banda_down.message}</p>}
                  </div>

                  {/* Ancho de Banda de Subida */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Límite de Subida de la Cola Padre (Mbps)
                    </label>
                    <input
                      type="number"
                      placeholder="Ej. 50 (0 = ilimitado)"
                      {...register('ancho_banda_up')}
                      className="input-field font-mono"
                    />
                    {errors.ancho_banda_up && <p className="text-xs text-destructive mt-1">{errors.ancho_banda_up.message}</p>}
                  </div>

                  {/* Nombre de la Cola Padre */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Nombre de la Cola Padre
                    </label>
                    <input
                      type="text"
                      placeholder="isp_PADRE_GLOBAL"
                      {...register('cola_padre')}
                      className="input-field font-mono"
                    />
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Prefijo obligatorio: <strong>isp_</strong>. Si se omite, se agregará automáticamente.
                    </span>
                    {errors.cola_padre && <p className="text-xs text-destructive mt-1">{errors.cola_padre.message}</p>}
                  </div>

                  {/* Nombre de la Address List de Clientes */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Nombre de la Address List de Clientes
                    </label>
                    <input
                      type="text"
                      placeholder="isp_clientes"
                      {...register('address_list')}
                      className="input-field font-mono"
                    />
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Prefijo obligatorio: <strong>isp_</strong>. Si se omite, se agregará automáticamente.
                    </span>
                    {errors.address_list && <p className="text-xs text-destructive mt-1">{errors.address_list.message}</p>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Registro de Tráfico y Control de Velocidad */}
                <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
                  <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                    <Activity className="w-4 h-4" /> Tráfico y Rendimiento
                  </div>

                  {/* Registro de tráfico */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <span className="text-sm font-medium text-foreground block">Registro de Tráfico</span>
                      <span className="text-xs text-muted-foreground">Monitorear y graficar consumo de interfaces</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input type="checkbox" {...register('monitoreo_trafico')} className="sr-only peer" />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                    </label>
                  </div>

                  {/* Control de velocidad */}
                  <div className="flex items-center justify-between py-2 border-t border-border/40 pt-4">
                    <div>
                      <span className="text-sm font-medium text-foreground block">Control de Velocidad</span>
                      <span className="text-xs text-muted-foreground">Administración dinámica de colas (Queues)</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input type="checkbox" {...register('control_velocidad')} className="sr-only peer" />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                    </label>
                  </div>
                </div>

                {/* Logs y Notificaciones */}
                <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
                  <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                    <Check className="w-4 h-4" /> Diagnóstico y Alertas
                  </div>

                  {/* Sincronización de Logs */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <span className="text-sm font-medium text-foreground block">Sincronización de Logs</span>
                      <span className="text-xs text-muted-foreground">Capturar y analizar registros de RouterOS</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input type="checkbox" {...register('sincronizar_logs')} className="sr-only peer" />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                    </label>
                  </div>

                  {/* Notificaciones y alertas */}
                  <div className="flex items-center justify-between py-2 border-t border-border/40 pt-4">
                    <div>
                      <span className="text-sm font-medium text-foreground block">Notificaciones de Estado</span>
                      <span className="text-xs text-muted-foreground">Alertas en caso de desconexión o latencia alta</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input type="checkbox" {...register('notificaciones_alertas')} className="sr-only peer" />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                    </label>
                  </div>
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

          {/* Acciones del Footer */}
          <div className="flex justify-between items-center border-t border-border/50 pt-4 mt-6">
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
                type="button"
                id="cancel-router-form"
                onClick={onClose}
                className="btn-secondary w-32 justify-center"
              >
                Cancelar
              </button>

              <button
                type="submit"
                id="save-router-btn"
                disabled={saveMutation.isPending}
                className="btn-primary w-44 justify-center"
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {saveMutation.isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar router'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
