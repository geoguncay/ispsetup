/**
 * ClientFormDialog — Modal para crear y editar clientes con mapa interactivo Leaflet.
 */
import { useState, useEffect, useCallback } from 'react'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, MapPin, User, CreditCard, Bell, Wifi, Check } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { validateEcuadorianDocument } from '@/lib/validators'

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

interface FormRouter {
  id: string
  nombre: string
  ip?: string
}

interface FormPlan {
  id: string
  nombre: string
  precio: number
}

interface FormCustomService {
  id: string
  nombre: string
  precio: number
  descripcion?: string
  recurrente: boolean
  activo: boolean
}

// Centrado por defecto en Quito, Ecuador
const DEFAULT_CENTER: [number, number] = [-0.180653, -78.467834]

const clientSchema = z.object({
  id: z.string().optional(),
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  tipo_documento: z.enum(['cedula', 'ruc']),
  cedula: z.string(),
  telefono: z.string().min(5, 'Mínimo 5 caracteres').max(40),
  direccion: z.string().min(5, 'Mínimo 5 caracteres').max(255),
  latitud: z.coerce.number().optional().nullable(),
  longitud: z.coerce.number().optional().nullable(),
  router_id: z.string().min(1, 'Debe seleccionar un router'),
  tipo: z.enum(['static', 'pppoe']),
  plan_id: z.string().optional().nullable(),
  custom_service_ids: z.array(z.string()).optional(),
  activo: z.boolean().optional(),
  ip: z.string().optional().nullable(),
  mac: z.string().optional().nullable(),
  notas_ip: z.string().optional().nullable(),
  usuario_ppp: z.string().optional().nullable(),
  contraseña_ppp: z.string().optional().nullable(),
  perfil_id: z.string().optional().nullable(),
  email: z.string().email('Ingrese un correo válido').optional().or(z.literal('')),
  created_at: z.string().optional().nullable(),
  // Campos ficticios para Paso 2 (Facturación y Notificaciones)
  dia_pago: z.string().optional().nullable(),
  metodo_pago: z.string().optional().nullable(),
  notif_email: z.boolean().optional(),
  notif_sms: z.boolean().optional(),
  notif_whatsapp: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // 1. Validar identificación (cédula o ruc)
  const tipo = data.tipo_documento
  const doc = data.cedula

  if (!doc) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La identificación es obligatoria',
      path: ['cedula'],
    })
  } else if (!/^\d+$/.test(doc)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Solo números',
      path: ['cedula'],
    })
  } else if (tipo === 'cedula') {
    if (doc.length !== 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La cédula ecuatoriana debe tener exactamente 10 dígitos',
        path: ['cedula'],
      })
    } else if (!validateEcuadorianDocument(doc, 'cedula')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La cédula ingresada no es válida',
        path: ['cedula'],
      })
    }
  } else if (tipo === 'ruc') {
    if (doc.length !== 13) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El RUC debe tener exactamente 13 dígitos',
        path: ['cedula'],
      })
    } else if (!validateEcuadorianDocument(doc, 'ruc')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El RUC ingresado no es válido',
        path: ['cedula'],
      })
    }
  }

  // 2. Validar IP obligatoria para tipo estática, o credenciales para PPPoE
  if (data.tipo === 'static' && (!data.ip || data.ip.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La dirección IP es obligatoria',
      path: ['ip'],
    })
  } else if (data.tipo === 'pppoe') {
    if (!data.usuario_ppp || data.usuario_ppp.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El usuario PPPoE es obligatorio',
        path: ['usuario_ppp'],
      })
    }
    if (!data.contraseña_ppp || data.contraseña_ppp.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La contraseña PPPoE es obligatoria',
        path: ['contraseña_ppp'],
      })
    }
    if (!data.plan_id || data.plan_id.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debe seleccionar un plan para la conexión PPPoE',
        path: ['plan_id'],
      })
    }
  }
})

type ClientFormData = z.infer<typeof clientSchema>

interface FormClient {
  id: string
  nombre: string
  cedula: string
  telefono: string
  direccion: string
  email?: string | null
  activo: boolean
  tipo: 'static' | 'pppoe'
  router_id: string
  latitud?: number | null
  longitud?: number | null
  created_at?: string | null
  plan_activo?: { id: string; nombre: string; precio: number } | null
  static_ip?: {
    ip: string
    mac?: string | null
    notas?: string | null
  } | null
  pppoe_secret?: {
    usuario_ppp: string
    contraseña_ppp: string
    perfil_id: string
  } | null
  custom_services?: { id: string; nombre: string; precio: number; recurrente: boolean }[] | null
}

interface ClientFormDialogProps {
  open: boolean
  onClose: () => void
  client?: FormClient | null
  onSuccess: () => void
}

export function ClientFormDialog({ open, onClose, client, onSuccess }: ClientFormDialogProps) {
  const isEdit = !!client
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema) as unknown as Resolver<ClientFormData>,
  })

  // Ver valores de lat/lng en tiempo real
  const latVal = watch('latitud')
  const lngVal = watch('longitud')
  const watchDocType = watch('tipo_documento')

  // Obtener Routers
  const { data: routers = [] } = useQuery<FormRouter[]>({
    queryKey: ['routers-form'],
    queryFn: async () => {
      const { data } = await api.get('/routers')
      return data
    },
    enabled: open,
  })

  // Obtener Planes
  const { data: plans = [] } = useQuery<FormPlan[]>({
    queryKey: ['plans-form'],
    queryFn: async () => {
      const { data } = await api.get('/plans')
      return data
    },
    enabled: open,
  })

  // Obtener Servicios Adicionales
  const { data: customServices = [] } = useQuery<FormCustomService[]>({
    queryKey: ['custom-services-form'],
    queryFn: async () => {
      const { data } = await api.get('/custom-services')
      return data.filter((cs: FormCustomService) => cs.activo)
    },
    enabled: open,
  })

  const selectedRouterId = watch('router_id')
  const selectedPlanId = watch('plan_id')
  const selectedCustomServiceIds = watch('custom_service_ids') || []

  const activePlanPrice = selectedPlanId
    ? plans.find((p) => p.id === selectedPlanId)?.precio || 0
    : client?.plan_activo
      ? client.plan_activo.precio
      : 0

  const recurringCustomServicesPrice = selectedCustomServiceIds.reduce((sum, csId) => {
    const cs = customServices.find((s) => s.id === csId)
    return sum + (cs && cs.recurrente ? Number(cs.precio) : 0)
  }, 0)

  const oneTimeCustomServicesPrice = selectedCustomServiceIds.reduce((sum, csId) => {
    const cs = customServices.find((s) => s.id === csId)
    return sum + (cs && !cs.recurrente ? Number(cs.precio) : 0)
  }, 0)

  const nextInvoiceTotal = Number(activePlanPrice) + recurringCustomServicesPrice + oneTimeCustomServicesPrice
  const futureMonthlyTotal = Number(activePlanPrice) + recurringCustomServicesPrice


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
      setErrorMessage(null)
      if (client) {
        reset({
          id: client.id,
          nombre: client.nombre,
          tipo_documento: client.cedula?.length === 13 ? 'ruc' : 'cedula',
          cedula: client.cedula,
          telefono: client.telefono,
          direccion: client.direccion,
          latitud: client.latitud,
          longitud: client.longitud,
          router_id: client.router_id,
          tipo: client.tipo,
          plan_id: client.plan_activo?.id ?? '',
          activo: client.activo,
          ip: client.static_ip?.ip ?? '',
          mac: client.static_ip?.mac ?? '',
          notas_ip: client.static_ip?.notas ?? '',
          usuario_ppp: client.pppoe_secret?.usuario_ppp ?? '',
          contraseña_ppp: client.pppoe_secret?.contraseña_ppp ?? '',
          perfil_id: client.pppoe_secret?.perfil_id ?? '',
          email: client.email ?? '',
          created_at: client.created_at ? client.created_at.split('T')[0] : '',
          dia_pago: '5',
          metodo_pago: 'transferencia',
          notif_email: true,
          notif_sms: false,
          notif_whatsapp: true,
          custom_service_ids: client.custom_services?.map((cs: any) => cs.id) ?? [],
        })
      } else {
        const today = new Date()
        const yyyy = today.getFullYear()
        const mm = String(today.getMonth() + 1).padStart(2, '0')
        const dd = String(today.getDate()).padStart(2, '0')
        const todayStr = `${yyyy}-${mm}-${dd}`
        reset({
          id: undefined,
          nombre: '',
          tipo_documento: 'cedula',
          cedula: '',
          telefono: '',
          direccion: '',
          latitud: null,
          longitud: null,
          router_id: '',
          tipo: 'static',
          plan_id: '',
          activo: true,
          ip: '',
          mac: '',
          notas_ip: '',
          usuario_ppp: '',
          contraseña_ppp: '',
          perfil_id: '',
          email: '',
          created_at: todayStr,
          dia_pago: '5',
          metodo_pago: 'transferencia',
          notif_email: true,
          notif_sms: false,
          notif_whatsapp: true,
          custom_service_ids: [],
        })
        handleGetLocation()
      }
    }
  }, [open, client, reset, setValue, handleGetLocation])

  const saveMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const payload = { ...data } as any
      if (!payload.custom_service_ids) {
        payload.custom_service_ids = []
      }
      delete payload.tipo_documento
      delete payload.dia_pago
      delete payload.metodo_pago
      delete payload.notif_email
      delete payload.notif_sms
      delete payload.notif_whatsapp
      
      if (!payload.plan_id) delete payload.plan_id
      if (payload.latitud === 0 || isNaN(Number(payload.latitud))) payload.latitud = null
      if (payload.longitud === 0 || isNaN(Number(payload.longitud))) payload.longitud = null

      const emailStr = payload.email as string | null | undefined
      if (!emailStr || emailStr.trim() === '') {
        payload.email = null
      }

      const createdAtStr = payload.created_at as string | null | undefined
      if (!createdAtStr || createdAtStr.trim() === '') {
        delete payload.created_at
      } else {
        payload.created_at = `${createdAtStr}T12:00:00`
      }

      if (payload.tipo === 'pppoe') {
        payload.ip = null
        payload.mac = null
        payload.notas_ip = null
      } else {
        const macStr = payload.mac as string | null | undefined
        if (!macStr || macStr.trim() === '') payload.mac = null
        const notasIpStr = payload.notas_ip as string | null | undefined
        if (!notasIpStr || notasIpStr.trim() === '') payload.notas_ip = null
        payload.usuario_ppp = null
        payload.contraseña_ppp = null
        payload.perfil_id = null
      }

      if (isEdit) {
        delete payload.plan_id // No modificamos plan_id vía update cliente directamente (se hace desde perfil)
        await api.put(`/clients/${client!.id}`, payload)
      } else {
        await api.post('/clients', payload)
      }
    },
    onSuccess,
    onError: (err: unknown) => {
      const errorResponse = err as { response?: { data?: { detail?: string } } }
      const msg = errorResponse?.response?.data?.detail || 'Error al guardar el cliente'
      setErrorMessage(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
  })

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
    const step1Fields = ['nombre', 'tipo_documento', 'cedula', 'telefono', 'direccion', 'email', 'created_at']
    const hasStep1Error = errorKeys.some((key) => step1Fields.includes(key))
    if (hasStep1Error) {
      setStep(1)
      return
    }
    setStep(3)
  }

  if (!open) return null

  // Coordenadas iniciales para render del Marker
  const mapCenter: [number, number] = latVal && lngVal ? [latVal, lngVal] : DEFAULT_CENTER

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-6xl mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {isEdit ? `Editar: ${client.nombre}` : 'Registrar Nuevo Cliente'}
          </h2>
          <button
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
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${
                step >= 1 
                  ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20' 
                  : 'bg-secondary border-border text-muted-foreground'
              }`}>
                {step > 1 ? <Check className="w-5 h-5" /> : <User className="w-5 h-5" />}
              </div>
              <span className={`text-[11px] font-semibold mt-1.5 transition-colors ${
                step === 1 ? 'text-brand-400 font-bold' : 'text-muted-foreground'
              }`}>
                1. Datos Personales
              </span>
            </button>

            {/* Paso 2 */}
            <button
              type="button"
              onClick={() => setStep(2)}
              className="relative z-10 flex flex-col items-center group cursor-pointer focus:outline-none"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${
                step >= 2 
                  ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20' 
                  : 'bg-secondary border-border text-muted-foreground'
              }`}>
                {step > 2 ? <Check className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
              </div>
              <span className={`text-[11px] font-semibold mt-1.5 transition-colors ${
                step === 2 ? 'text-brand-400 font-bold' : 'text-muted-foreground'
              }`}>
                2. Facturación y Avisos
              </span>
            </button>

            {/* Paso 3 */}
            <button
              type="button"
              onClick={() => setStep(3)}
              className="relative z-10 flex flex-col items-center group cursor-pointer focus:outline-none"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${
                step === 3 
                  ? 'bg-brand-500 border-brand-500 text-white shadow-lg shadow-brand-500/20' 
                  : 'bg-secondary border-border text-muted-foreground'
              }`}>
                <Wifi className="w-5 h-5" />
              </div>
              <span className={`text-[11px] font-semibold mt-1.5 transition-colors ${
                step === 3 ? 'text-brand-400 font-bold' : 'text-muted-foreground'
              }`}>
                3. Servicios y Red
              </span>
            </button>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data), onFormError)} className="p-5 space-y-5">
          {errorMessage && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
              {errorMessage}
            </div>
          )}

          {/* PASO 1: DATOS PERSONALES */}
          {step === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
              {/* Campos a la izquierda */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                  <User className="w-4 h-4" /> Información de Contacto
                </div>

                {/* Nombre completo */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Nombre Completo *</label>
                  <input
                    type="text"
                    placeholder="Juan Andres Perez"
                    {...register('nombre')}
                    className="input-field"
                  />
                  {errors.nombre && <p className="text-xs text-destructive mt-1">{errors.nombre.message}</p>}
                </div>

                {/* Tipo Identificación, Identificación y Teléfono */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Tipo Doc. *</label>
                    <select
                      {...register('tipo_documento')}
                      className="input-field cursor-pointer"
                    >
                      <option value="cedula">Cédula</option>
                      <option value="ruc">RUC</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      {watchDocType === 'ruc' ? 'RUC *' : 'Cédula *'}
                    </label>
                    <input
                      type="text"
                      placeholder={watchDocType === 'ruc' ? '1724024888001' : '1724024888'}
                      {...register('cedula')}
                      className="input-field font-mono"
                    />
                    {errors.cedula && <p className="text-xs text-destructive mt-1">{errors.cedula.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Teléfono *</label>
                    <input
                      type="text"
                      placeholder="0999999999"
                      {...register('telefono')}
                      className="input-field font-mono"
                    />
                    {errors.telefono && <p className="text-xs text-destructive mt-1">{errors.telefono.message}</p>}
                  </div>
                </div>

                {/* Correo Electrónico y Fecha de Registro */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Correo Electrónico <span className="text-muted-foreground text-xs">(opcional)</span></label>
                    <input
                      type="email"
                      placeholder="ejemplo@correo.com"
                      {...register('email')}
                      className="input-field"
                    />
                    {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Fecha de Registro *</label>
                    <input
                      type="date"
                      {...register('created_at')}
                      className="input-field font-sans cursor-pointer"
                      onClick={(e) => {
                        try {
                          e.currentTarget.showPicker()
                        } catch {
                          // ignore
                        }
                      }}
                      onFocus={(e) => {
                        try {
                          e.currentTarget.showPicker()
                        } catch {
                          // ignore
                        }
                      }}
                    />
                    {errors.created_at && <p className="text-xs text-destructive mt-1">{errors.created_at.message}</p>}
                  </div>
                </div>

                {/* Dirección */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Dirección de Domicilio *</label>
                  <input
                    type="text"
                    placeholder="Calle 12 y Av. Amazonas"
                    {...register('direccion')}
                    className="input-field"
                  />
                  {errors.direccion && <p className="text-xs text-destructive mt-1">{errors.direccion.message}</p>}
                </div>

                {/* Coordenadas GPS (Inputs manuales) */}
                <div className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3">
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
              </div>

              {/* Mapa interactivo a la derecha */}
              <div className="flex flex-col h-full min-h-[300px] lg:min-h-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-brand-400" />
                    Marcar ubicación en el mapa
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

                <div className="flex-1 rounded-lg border border-border overflow-hidden h-72 lg:h-[350px]">
                  <MapContainer
                    center={mapCenter}
                    zoom={12}
                    scrollWheelZoom={true}
                    style={{ height: '100%', width: '100%', zIndex: 10 }}
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

          {/* PASO 2: FACTURACIÓN Y AVISOS */}
          {step === 2 && (
            <div className="space-y-6 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 flex gap-3.5 items-start">
                <div className="p-2 bg-brand-500/20 text-brand-400 rounded-lg shrink-0">
                  <Bell className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-brand-300">Configuración de Avisos y Facturación</h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Este módulo se encuentra en fase de diseño técnico. Las opciones seleccionadas a continuación 
                    servirán como pre-configuración y se vincularán automáticamente cuando se active la pasarela 
                    de facturación electrónica y notificaciones.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Panel Facturación */}
                <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
                  <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                    <CreditCard className="w-4 h-4" /> Preferencias de Facturación
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Día de Pago Preferido</label>
                    <select {...register('dia_pago')} className="input-field cursor-pointer font-sans">
                      <option value="1">Día 1 de cada mes</option>
                      <option value="5">Día 5 de cada mes (Recomendado)</option>
                      <option value="10">Día 10 de cada mes</option>
                      <option value="15">Día 15 de cada mes</option>
                      <option value="28">Día 28 de cada mes</option>
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Determina la fecha límite del corte de servicio y envío de cobros.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Método de Pago Habitual</label>
                    <select {...register('metodo_pago')} className="input-field cursor-pointer font-sans">
                      <option value="transferencia">Transferencia Bancaria / Depósito</option>
                      <option value="efectivo">Pago en Efectivo (Oficina)</option>
                      <option value="debito_automatico">Débito Automático</option>
                      <option value="tarjeta">Tarjeta de Crédito / Débito</option>
                    </select>
                  </div>

                  {/* Toggle para factura digital */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-sm font-medium text-foreground block">Envío Automático de Invoices</span>
                      <span className="text-xs text-muted-foreground">Enviar factura digital al correo</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input type="checkbox" className="sr-only peer" defaultChecked />
                      <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                    </label>
                  </div>
                </div>

                {/* Panel Notificaciones */}
                <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
                  <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                    <Bell className="w-4 h-4" /> Canales de Notificación Activos
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Seleccione los medios por los cuales el cliente recibirá estados de cuenta, alertas de pago y avisos de mantenimiento.
                  </p>

                  <div className="space-y-3.5 pt-2">
                    {/* Canal WhatsApp */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                          <span className="font-semibold text-xs">WA</span>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-foreground block">WhatsApp</span>
                          <span className="text-xs text-muted-foreground">Mensajes de cobro y recordatorios</span>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input type="checkbox" {...register('notif_whatsapp')} className="sr-only peer" />
                        <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </label>
                    </div>

                    {/* Canal Correo */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                          <span className="font-semibold text-xs">@</span>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-foreground block">Correo Electrónico</span>
                          <span className="text-xs text-muted-foreground">Reportes de red y facturas PDF</span>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input type="checkbox" {...register('notif_email')} className="sr-only peer" />
                        <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </label>
                    </div>

                    {/* Canal SMS */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-500/20">
                          <span className="font-semibold text-xs">SMS</span>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-foreground block">Mensajería SMS</span>
                          <span className="text-xs text-muted-foreground">Alertas críticas de suspensión</span>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input type="checkbox" {...register('notif_sms')} className="sr-only peer" />
                        <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 3: SERVICIOS Y RED */}
          {step === 3 && (
            <div className="space-y-5 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <Wifi className="w-4 h-4" /> Configuración de Red e Internet
              </div>

              <div className="glass-card p-6 border border-border/60 space-y-4 bg-secondary/10">
                {/* Plan Inicial (Solo visible en creación) */}
                {!isEdit ? (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Plan de Internet inicial *</label>
                    <select {...register('plan_id')} className="input-field cursor-pointer">
                      <option value="">Seleccione un plan inicial</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre} (${Number(p.precio).toFixed(2)})</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      El plan seleccionado se activará inmediatamente tras registrar el cliente.
                    </p>
                  </div>
                ) : (
                   <div className="bg-brand-500/10 border border-brand-500/20 rounded-lg p-3 text-xs text-brand-300">
                    ℹ️ Para modificar el plan activo o aplicar promociones, dirígete al perfil del cliente una vez guardados los cambios.
                  </div>
                )}
                {/* Servicios de Valor Agregado / Adicionales */}
                <div className="border-t border-border/40 pt-4 mt-2 space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-brand-400 uppercase tracking-wider mb-1">
                      Servicios Adicionales (Valores Agregados)
                    </label>
                    <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                      Selecciona los servicios adicionales personalizados para este cliente. Estos se sumarán al cobro de su plan mensual.
                    </p>
                  </div>

                  {customServices.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic bg-secondary/20 p-3 rounded-lg border border-border/40 text-center">
                      No hay servicios adicionales activos configurados en el catálogo.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {customServices.map((cs) => {
                        const isSelected = selectedCustomServiceIds.includes(cs.id)
                        return (
                          <label
                            key={cs.id}
                            className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer select-none bg-secondary/10 hover:bg-secondary/20 ${
                              isSelected
                                ? 'border-brand-500/50 shadow-lg shadow-brand-500/5 bg-brand-500/5'
                                : 'border-border/60 hover:border-border/80'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                const updatedIds = isSelected
                                  ? selectedCustomServiceIds.filter((id) => id !== cs.id)
                                  : [...selectedCustomServiceIds, cs.id]
                                setValue('custom_service_ids', updatedIds)
                              }}
                              className="mt-1 accent-brand-500 rounded border-border cursor-pointer"
                            />
                            <div className="space-y-0.5">
                              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                                {cs.nombre}
                                <span className="text-[10px] font-mono font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded">
                                  +${Number(cs.precio).toFixed(2)}
                                </span>
                                <span className={`text-[8px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                                  cs.recurrente
                                    ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                    : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                                }`}>
                                  {cs.recurrente ? 'Mensual' : 'Pago Único'}
                                </span>
                              </span>
                              {cs.descripcion && (
                                <span className="text-[11px] text-muted-foreground leading-normal block">
                                  {cs.descripcion}
                                </span>
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {/* Tarjeta de Resumen / Factura Estimada */}
                  <div className="bg-brand-500/10 border border-brand-500/20 rounded-xl p-4 flex flex-col gap-3 mt-3">
                    <div className="flex justify-between items-center pb-2 border-b border-brand-500/10">
                      <div>
                        <h4 className="text-xs font-bold text-brand-300 uppercase tracking-wider">Simulación de Facturación</h4>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
                          Desglose estimado de cobros para el cliente.
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-y-1.5 text-xs font-medium text-muted-foreground">
                      <span>Plan Base:</span>
                      <span className="text-right text-foreground font-mono">${Number(activePlanPrice).toFixed(2)}/mes</span>

                      {recurringCustomServicesPrice > 0 && (
                        <>
                          <span>Adicionales Recurrentes:</span>
                          <span className="text-right text-foreground font-mono">${recurringCustomServicesPrice.toFixed(2)}/mes</span>
                        </>
                      )}

                      {oneTimeCustomServicesPrice > 0 && (
                        <>
                          <span className="text-purple-400 font-semibold">Cargos Únicos (Siguiente Factura):</span>
                          <span className="text-right text-purple-400 font-semibold font-mono">${oneTimeCustomServicesPrice.toFixed(2)}</span>
                        </>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2 border-t border-brand-500/10 mt-1">
                      <div>
                        <span className="text-[10px] text-muted-foreground block font-semibold uppercase tracking-wider">Próximo Total Cobrado</span>
                        <span className="text-lg font-mono font-black text-brand-400">${nextInvoiceTotal.toFixed(2)}</span>
                      </div>
                      <div className="text-left sm:text-right shrink-0">
                        <span className="text-[10px] text-muted-foreground block font-semibold uppercase tracking-wider">Mensualidad Recurrente Posterior</span>
                        <span className="text-sm font-mono font-bold text-brand-300">${futureMonthlyTotal.toFixed(2)}/mes</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Router asignado y Tipo de Conexión */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/40 pt-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Router asignado *</label>
                    <select {...register('router_id')} className="input-field cursor-pointer">
                      <option value="">Seleccione router</option>
                      {routers.map((r) => (
                        <option key={r.id} value={r.id}>{r.nombre} ({r.ip})</option>
                      ))}
                    </select>
                    {errors.router_id && <p className="text-xs text-destructive mt-1">{errors.router_id.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Tipo de Conexión *</label>
                    <select {...register('tipo')} className="input-field cursor-pointer">
                      <option value="static">IP Estática</option>
                      <option value="pppoe">PPPoE</option>
                    </select>
                    {errors.tipo && <p className="text-xs text-destructive mt-1">{errors.tipo.message}</p>}
                  </div>
                </div>

                {/* Campos condicionales para IP Estática */}
                {watch('tipo') === 'static' && (
                  <div className="space-y-4 border-l-2 border-brand-500 pl-4 py-1.5 mt-2 bg-brand-500/5 rounded-r-lg pr-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Dirección IP *</label>
                        <input
                          type="text"
                          placeholder="192.168.10.50"
                          {...register('ip')}
                          className="input-field font-mono"
                        />
                        {errors.ip && <p className="text-xs text-destructive mt-1">{errors.ip.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Dirección MAC</label>
                        <input
                          type="text"
                          placeholder="AA:BB:CC:DD:EE:FF"
                          {...register('mac')}
                          className="input-field font-mono"
                        />
                        {errors.mac && <p className="text-xs text-destructive mt-1">{errors.mac.message}</p>}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Notas de Red</label>
                      <input
                        type="text"
                        placeholder="Ej: Antena LiteBeam, Ubiquiti, etc."
                        {...register('notas_ip')}
                        className="input-field"
                      />
                    </div>
                  </div>
                )}

                {/* Campos condicionales para PPPoE */}
                {watch('tipo') === 'pppoe' && (
                  <div className="space-y-4 border-l-2 border-brand-500 pl-4 py-1.5 mt-2 bg-brand-500/5 rounded-r-lg pr-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Usuario PPPoE *</label>
                        <input
                          type="text"
                          placeholder="juan.perez"
                          {...register('usuario_ppp')}
                          className="input-field font-mono"
                        />
                        {errors.usuario_ppp && <p className="text-xs text-destructive mt-1">{errors.usuario_ppp.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Contraseña PPPoE *</label>
                        <input
                          type="text"
                          placeholder="p4ssw0rd"
                          {...register('contraseña_ppp')}
                          className="input-field font-mono"
                        />
                        {errors.contraseña_ppp && <p className="text-xs text-destructive mt-1">{errors.contraseña_ppp.message}</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Acciones del Modal */}
          <div className="flex justify-end items-center gap-3 border-t border-border/50 pt-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-32 justify-center"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="btn-primary w-44 justify-center"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {saveMutation.isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Registrar cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
