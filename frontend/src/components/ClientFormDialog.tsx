/**
 * ClientFormDialog — Modal para crear y editar clientes con mapa interactivo Leaflet.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, MapPin, User, CreditCard, Bell, Wifi, Layers, Package, Plus, Search } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'
import { getBillingDueDateSettings, getCatalogSettings } from '@/services/systemSettings'
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

interface FormGateway {
  id: string
  name: string
  ip?: string
  latitude?: number | null
  longitude?: number | null
  site_name?: string | null
}

interface FormPlan {
  id: string
  name: string
  price: number
  speed_down_mbps?: number
  speed_up_mbps?: number
  description?: string
  taxes?: number
}

interface FormCustomService {
  id: string
  name: string
  price: number
  description?: string
  recurring: boolean
  active: boolean
}

interface InventoryItemOption {
  id: string
  name: string
  code: string
  model: string | null
  category: string | null
  quantity: number
}

interface SelectedInventoryItem {
  inventory_item_id: string
  item_name: string
  item_code: string
  quantity: number
  serial_number: string
  mac: string
  notes: string
}

const splitClientName = (fullName: string) => {
  const trimmed = (fullName || '').trim()
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',')
    return {
      last_name: parts[0].trim(),
      first_name: parts.slice(1).join(',').trim()
    }
  }
  const words = trimmed.split(/\s+/)
  if (words.length <= 1) {
    return { last_name: '', first_name: trimmed }
  } else if (words.length === 2) {
    return { last_name: words[1], first_name: words[0] }
  } else if (words.length === 3) {
    return { last_name: words.slice(1).join(' '), first_name: words[0] }
  } else {
    const middle = Math.ceil(words.length / 2)
    return {
      first_name: words.slice(0, middle).join(' '),
      last_name: words.slice(middle).join(' ')
    }
  }
}

// Centrado por defecto en Quito, Ecuador
const DEFAULT_CENTER: [number, number] = [-0.180653, -78.467834]

// Catálogos de respaldo, usados mientras carga /settings/catalogs o si aún no se ha configurado nada en Ajustes
const DEFAULT_PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'deposit', label: 'Depósito' },
]
const DEFAULT_CUTOFF_DATES = [1, 5, 10, 15, 28]

const clientSchema = z.object({
  id: z.string().optional(),
  last_name: z.string().min(2, 'Mínimo 2 caracteres').max(60),
  first_name: z.string().min(2, 'Mínimo 2 caracteres').max(60),
  name: z.string().optional(),
  document_type: z.enum(['cedula', 'ruc']),
  cedula: z.string(),
  phone: z.string().max(40).optional().or(z.literal('')),
  address: z.string().min(5, 'Mínimo 5 caracteres').max(255),
  latitude: z.coerce.number().optional().nullable(),
  longitude: z.coerce.number().optional().nullable(),
  gateway_id: z.string().min(1, 'Debe seleccionar un router'),
  connection_type: z.enum(['static', 'pppoe']),
  plan_id: z.string().optional().nullable(),
  custom_service_ids: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  ip: z.string().optional().nullable(),
  mac: z.string().optional().nullable(),
  notes_ip: z.string().optional().nullable(),
  ppp_username: z.string().optional().nullable(),
  ppp_password: z.string().optional().nullable(),
  profile_id: z.string().optional().nullable(),
  email: z.string().min(1, 'El correo electrónico es obligatorio').email('Ingrese un correo válido'),
  created_at: z.string().optional().nullable(),
  billing_start: z.string().optional().nullable(),
  billing_period_start_day: z.coerce.number().min(1).max(31).optional().nullable(),
  invoice_advance_days: z.coerce.number().min(0).optional().nullable(),
  billing_type: z.string().optional().nullable(),
  auto_apply_payment: z.boolean().optional(),
  use_auto_credit: z.boolean().optional(),
  separate_proration: z.boolean().optional(),
  // Campos ficticios para Paso 2 (Facturación y Notificaciones)
  dia_pago: z.string().optional().nullable(),
  metodo_pago: z.string().optional().nullable(),
  notif_email: z.boolean().optional(),
  notif_sms: z.boolean().optional(),
  notif_whatsapp: z.boolean().optional(),
}).superRefine((data, ctx) => {
  // 1. Validar identificación (cédula o ruc)
  const connection_type = data.document_type
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
  } else if (connection_type === 'cedula') {
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
  } else if (connection_type === 'ruc') {
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

  // 2. Validar IP obligatoria para connection_type estática, o credenciales para PPPoE
  if (data.connection_type === 'static' && (!data.ip || data.ip.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La dirección IP es obligatoria',
      path: ['ip'],
    })
  } else if (data.connection_type === 'pppoe') {
    if (!data.ppp_username || data.ppp_username.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El usuario PPPoE es obligatorio',
        path: ['ppp_username'],
      })
    }
    if (!data.ppp_password || data.ppp_password.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'La contraseña PPPoE es obligatoria',
        path: ['ppp_password'],
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
  name: string
  last_name?: string | null
  first_name?: string | null
  cedula: string
  phone: string
  address: string
  email?: string | null
  active: boolean
  connection_type: 'static' | 'pppoe'
  gateway_id: string
  latitude?: number | null
  longitude?: number | null
  created_at?: string | null
  billing_start?: string | null
  billing_period_start_day?: number | null
  invoice_advance_days?: number | null
  billing_type?: string | null
  auto_apply_payment?: boolean | null
  use_auto_credit?: boolean | null
  separate_proration?: boolean | null
  plan_activo?: { id: string; name: string; price: number } | null
  static_ip?: {
    ip: string
    mac?: string | null
    notes?: string | null
  } | null
  pppoe_secret?: {
    ppp_username: string
    ppp_password: string
    profile_id: string
  } | null
  custom_services?: { id: string; name: string; price: number; recurring: boolean }[] | null
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
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)

  // Estado para equipos de inventario asignados
  const [selectedInventoryItems, setSelectedInventoryItems] = useState<SelectedInventoryItem[]>([])
  const initialInventoryItemsRef = useRef<string>('[]')
  const [showAddEquipment, setShowAddEquipment] = useState(false)
  const [newEquipmentItemId, setNewEquipmentItemId] = useState('')
  const [newEquipmentQuantity, setNewEquipmentQuantity] = useState(1)
  const [newEquipmentSerial, setNewEquipmentSerial] = useState('')
  const [newEquipmentMac, setNewEquipmentMac] = useState('')
  const [newEquipmentNotes, setNewEquipmentNotes] = useState('')

  // Estado para el buscador de servicios adicionales
  const [serviceSearch, setServiceSearch] = useState('')
  const [showServiceDropdown, setShowServiceDropdown] = useState(false)

  // Catálogos (métodos de pago, fechas de corte) desde Ajustes → Método de Pago / Fechas de Corte
  const { data: catalogSettings } = useQuery({
    queryKey: ['catalog-settings'],
    queryFn: getCatalogSettings,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })
  const methods = catalogSettings?.payment_methods?.length ? catalogSettings.payment_methods : DEFAULT_PAYMENT_METHODS
  const cutoffDates = catalogSettings?.cutoff_dates?.length ? catalogSettings.cutoff_dates : DEFAULT_CUTOFF_DATES

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema) as unknown as Resolver<ClientFormData>,
  })

  // Ver valores de lat/lng en tiempo real
  const latVal = watch('latitude')
  const lngVal = watch('longitude')
  const watchDocType = watch('document_type')
  const watchCedula = watch('cedula')

  useEffect(() => {
    if (watchCedula) {
      setValue('document_type', watchCedula.length === 13 ? 'ruc' : 'cedula')
    }
  }, [watchCedula, setValue])

  // Obtener Gateways
  const { data: gateways = [] } = useQuery<FormGateway[]>({
    queryKey: ['gateways-form'],
    queryFn: async () => {
      const { data } = await api.get('/gateways')
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

  // Obtener artículos de inventario para asignar
  const { data: inventoryItems = [] } = useQuery<InventoryItemOption[]>({
    queryKey: ['inventory-form'],
    queryFn: async () => {
      const { data } = await api.get('/inventory')
      return data
    },
    enabled: open,
  })

  // Obtener Servicios Adicionales
  const { data: customServices = [] } = useQuery<FormCustomService[]>({
    queryKey: ['custom-services-form'],
    queryFn: async () => {
      const { data } = await api.get('/custom-services')
      return data.filter((cs: FormCustomService) => cs.active)
    },
    enabled: open,
  })

  // Reglas de vencimiento de facturas (Ajustes → Facturación), usadas por el simulador
  const { data: dueDateSettings } = useQuery({
    queryKey: ['billing-due-date-settings'],
    queryFn: getBillingDueDateSettings,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const selectedGatewayId = watch('gateway_id')
  const selectedPlanId = watch('plan_id')
  const selectedCustomServiceIds = watch('custom_service_ids') || []

  // Detecta cambios reales en el modal (campos del formulario + equipos asignados)
  // para resaltar el botón Guardar solo cuando hay algo que persistir.
  const inventoryItemsChanged = JSON.stringify(selectedInventoryItems) !== initialInventoryItemsRef.current
  const hasChanges = isDirty || inventoryItemsChanged

  const activePlanPrice = selectedPlanId
    ? plans.find((p) => p.id === selectedPlanId)?.price || 0
    : client?.plan_activo
      ? client.plan_activo.price
      : 0

  const recurringCustomServicesPrice = selectedCustomServiceIds.reduce((sum, csId) => {
    const cs = customServices.find((s) => s.id === csId)
    return sum + (cs && cs.recurring ? Number(cs.price) : 0)
  }, 0)

  const oneTimeCustomServicesPrice = selectedCustomServiceIds.reduce((sum, csId) => {
    const cs = customServices.find((s) => s.id === csId)
    return sum + (cs && !cs.recurring ? Number(cs.price) : 0)
  }, 0)

  const nextInvoiceTotal = Number(activePlanPrice) + recurringCustomServicesPrice + oneTimeCustomServicesPrice
  const futureMonthlyTotal = Number(activePlanPrice) + recurringCustomServicesPrice

  const watchDiaPago = watch('dia_pago')
  const watchCreatedAt = watch('created_at')
  const watchBillingStart = watch('billing_start')
  const watchBillingPeriodStartDay = watch('billing_period_start_day')
  const watchBillingType = watch('billing_type')
  const watchInvoiceAdvanceDays = watch('invoice_advance_days')
  const watchSeparateProration = watch('separate_proration')

  const getSimulation = () => {
    const startStr = watchBillingStart || new Date().toISOString().split('T')[0]
    const startDay = Number(watchBillingPeriodStartDay) || 1
    const billingType = watchBillingType || 'forward'
    const advanceDays = Number(watchInvoiceAdvanceDays) || 0
    const separateProration = !!watchSeparateProration

    const planPrice = Number(activePlanPrice) || 0
    const planName = selectedPlanId
      ? plans.find((p) => p.id === selectedPlanId)?.name || 'Plan Contratado'
      : client?.plan_activo?.name || 'Plan Contratado'

    const formatDate = (date: Date) => {
      const day = String(date.getDate()).padStart(2, '0')
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const year = date.getFullYear()
      return `${day}/${month}/${year}`
    }

    const addDays = (date: Date, days: number) => {
      const d = new Date(date.getTime())
      d.setDate(d.getDate() + days)
      return d
    }

    // Replica la regla de vencimiento configurada en Ajustes → Facturación (backend: billing.py _resolve_due_date)
    const resolveDueDate = (creationDate: Date) => {
      const mode = dueDateSettings?.billing_due_mode || 'fixed_term'
      if (mode === 'cutoff_date') {
        const lastDayOfMonth = new Date(creationDate.getFullYear(), creationDate.getMonth() + 1, 0).getDate()
        const day = Math.min(startDay, lastDayOfMonth)
        let dueDate = new Date(creationDate.getFullYear(), creationDate.getMonth(), day)
        if (dueDate.getTime() < new Date(creationDate.getFullYear(), creationDate.getMonth(), creationDate.getDate()).getTime()) {
          const nextMonth = creationDate.getMonth() + 1
          const nextYear = creationDate.getFullYear() + (nextMonth > 11 ? 1 : 0)
          const nextMNormalized = nextMonth > 11 ? 0 : nextMonth
          const lastDayNext = new Date(nextYear, nextMNormalized + 1, 0).getDate()
          dueDate = new Date(nextYear, nextMNormalized, Math.min(startDay, lastDayNext))
        }
        return dueDate
      }
      const graceDays = dueDateSettings?.billing_default_grace_days ?? 10
      return addDays(creationDate, graceDays)
    }

    const parts = startStr.split('-')
    const startY = Number(parts[0])
    const startM = Number(parts[1]) - 1
    const startD = Number(parts[2])

    const D_start = new Date(startY, startM, startD)

    let periodStart = new Date(startY, startM, Math.min(startDay, new Date(startY, startM + 1, 0).getDate()))
    if (D_start < periodStart) {
      const prevM = startM - 1
      const prevY = prevM < 0 ? startY - 1 : startY
      const prevMNormalized = prevM < 0 ? 11 : prevM
      periodStart = new Date(prevY, prevMNormalized, Math.min(startDay, new Date(prevY, prevMNormalized + 1, 0).getDate()))
    }

    const nextM = periodStart.getMonth() + 1
    const nextY = periodStart.getFullYear() + (nextM > 11 ? 1 : 0)
    const nextMNormalized = nextM > 11 ? 0 : nextM
    const periodNextStart = new Date(nextY, nextMNormalized, Math.min(startDay, new Date(nextY, nextMNormalized + 1, 0).getDate()))

    const periodEnd = new Date(periodNextStart.getTime() - 24 * 60 * 60 * 1000)

    const normalDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)) + 1
    const proratedDays = Math.round((periodEnd.getTime() - D_start.getTime()) / (24 * 60 * 60 * 1000)) + 1

    const ratio = Math.max(0, Math.min(1, proratedDays / normalDays))
    const proratedPlanPrice = planPrice * ratio
    const proratedRecurringServicesPrice = recurringCustomServicesPrice * ratio

    let firstInvoice: {
      periodoDesde: string
      periodoHasta: string
      nombrePlan: string
      monto: number
      fechaCreacion: string
      fechaVencimiento: string
    }

    let nextInvoice: {
      periodoDesde: string
      periodoHasta: string
      nombrePlan: string
      monto: number
      fechaCreacion: string
      fechaVencimiento: string
    }

    const isProrated = D_start.getTime() > periodStart.getTime() && ratio < 1.0

    if (isProrated) {
      if (separateProration) {
        const firstMonto = proratedPlanPrice + proratedRecurringServicesPrice + oneTimeCustomServicesPrice

        let creationDate: Date
        if (billingType === 'forward') {
          creationDate = D_start
        } else {
          creationDate = periodNextStart
        }
        const finalCreationDate = addDays(creationDate, -advanceDays)
        const dueDate = resolveDueDate(finalCreationDate)

        firstInvoice = {
          periodoDesde: formatDate(D_start),
          periodoHasta: formatDate(periodEnd),
          nombrePlan: planName,
          monto: Number(firstMonto.toFixed(2)),
          fechaCreacion: formatDate(finalCreationDate),
          fechaVencimiento: formatDate(dueDate),
        }

        const nextMonto = planPrice + recurringCustomServicesPrice

        let nextCreationDate: Date
        if (billingType === 'forward') {
          nextCreationDate = periodNextStart
        } else {
          const nextNextM = periodNextStart.getMonth() + 1
          const nextNextY = periodNextStart.getFullYear() + (nextNextM > 11 ? 1 : 0)
          const nextNextMNormalized = nextNextM > 11 ? 0 : nextNextM
          nextCreationDate = new Date(nextNextY, nextNextMNormalized, Math.min(startDay, new Date(nextNextY, nextNextMNormalized + 1, 0).getDate()))
        }
        const finalNextCreationDate = addDays(nextCreationDate, -advanceDays)
        const nextDueDate = resolveDueDate(finalNextCreationDate)

        const nextNextM = periodNextStart.getMonth() + 1
        const nextNextY = periodNextStart.getFullYear() + (nextNextM > 11 ? 1 : 0)
        const nextNextMNormalized = nextNextM > 11 ? 0 : nextNextM
        const periodNextNextStart = new Date(nextNextY, nextNextMNormalized, Math.min(startDay, new Date(nextNextY, nextNextMNormalized + 1, 0).getDate()))
        const nextPeriodEnd = new Date(periodNextNextStart.getTime() - 24 * 60 * 60 * 1000)

        nextInvoice = {
          periodoDesde: formatDate(periodNextStart),
          periodoHasta: formatDate(nextPeriodEnd),
          nombrePlan: planName,
          monto: Number(nextMonto.toFixed(2)),
          fechaCreacion: formatDate(finalNextCreationDate),
          fechaVencimiento: formatDate(nextDueDate),
        }
      } else {
        const nextNextM = periodNextStart.getMonth() + 1
        const nextNextY = periodNextStart.getFullYear() + (nextNextM > 11 ? 1 : 0)
        const nextNextMNormalized = nextNextM > 11 ? 0 : nextNextM
        const periodNextNextStart = new Date(nextNextY, nextNextMNormalized, Math.min(startDay, new Date(nextNextY, nextNextMNormalized + 1, 0).getDate()))
        const nextPeriodEnd = new Date(periodNextNextStart.getTime() - 24 * 60 * 60 * 1000)

        const firstMonto = proratedPlanPrice + proratedRecurringServicesPrice + planPrice + recurringCustomServicesPrice + oneTimeCustomServicesPrice

        let creationDate: Date
        if (billingType === 'forward') {
          creationDate = D_start
        } else {
          creationDate = periodNextNextStart
        }
        const finalCreationDate = addDays(creationDate, -advanceDays)
        const dueDate = resolveDueDate(finalCreationDate)

        firstInvoice = {
          periodoDesde: formatDate(D_start),
          periodoHasta: formatDate(nextPeriodEnd),
          nombrePlan: planName,
          monto: Number(firstMonto.toFixed(2)),
          fechaCreacion: formatDate(finalCreationDate),
          fechaVencimiento: formatDate(dueDate),
        }

        const nextMonto = planPrice + recurringCustomServicesPrice

        let nextCreationDate: Date
        if (billingType === 'forward') {
          nextCreationDate = periodNextNextStart
        } else {
          const n3M = periodNextNextStart.getMonth() + 1
          const n3Y = periodNextNextStart.getFullYear() + (n3M > 11 ? 1 : 0)
          const n3MNormalized = n3M > 11 ? 0 : n3M
          nextCreationDate = new Date(n3Y, n3MNormalized, Math.min(startDay, new Date(n3Y, n3MNormalized + 1, 0).getDate()))
        }
        const finalNextCreationDate = addDays(nextCreationDate, -advanceDays)
        const nextDueDate = resolveDueDate(finalNextCreationDate)

        const n3M = periodNextNextStart.getMonth() + 1
        const n3Y = periodNextNextStart.getFullYear() + (n3M > 11 ? 1 : 0)
        const n3MNormalized = n3M > 11 ? 0 : n3M
        const periodN3Start = new Date(n3Y, n3MNormalized, Math.min(startDay, new Date(n3Y, n3MNormalized + 1, 0).getDate()))
        const nextNextPeriodEnd = new Date(periodN3Start.getTime() - 24 * 60 * 60 * 1000)

        nextInvoice = {
          periodoDesde: formatDate(periodNextNextStart),
          periodoHasta: formatDate(nextNextPeriodEnd),
          nombrePlan: planName,
          monto: Number(nextMonto.toFixed(2)),
          fechaCreacion: formatDate(finalNextCreationDate),
          fechaVencimiento: formatDate(nextDueDate),
        }
      }
    } else {
      const firstMonto = planPrice + recurringCustomServicesPrice + oneTimeCustomServicesPrice

      let creationDate: Date
      if (billingType === 'forward') {
        creationDate = D_start
      } else {
        creationDate = periodNextStart
      }
      const finalCreationDate = addDays(creationDate, -advanceDays)
      const dueDate = resolveDueDate(finalCreationDate)

      firstInvoice = {
        periodoDesde: formatDate(D_start),
        periodoHasta: formatDate(periodEnd),
        nombrePlan: planName,
        monto: Number(firstMonto.toFixed(2)),
        fechaCreacion: formatDate(finalCreationDate),
        fechaVencimiento: formatDate(dueDate),
      }

      const nextMonto = planPrice + recurringCustomServicesPrice
      let nextCreationDate: Date
      if (billingType === 'forward') {
        nextCreationDate = periodNextStart
      } else {
        const nextNextM = periodNextStart.getMonth() + 1
        const nextNextY = periodNextStart.getFullYear() + (nextNextM > 11 ? 1 : 0)
        const nextNextMNormalized = nextNextM > 11 ? 0 : nextNextM
        nextCreationDate = new Date(nextNextY, nextNextMNormalized, Math.min(startDay, new Date(nextNextY, nextNextMNormalized + 1, 0).getDate()))
      }
      const finalNextCreationDate = addDays(nextCreationDate, -advanceDays)
      const nextDueDate = resolveDueDate(finalNextCreationDate)

      const nextNextM = periodNextStart.getMonth() + 1
      const nextNextY = periodNextStart.getFullYear() + (nextNextM > 11 ? 1 : 0)
      const nextNextMNormalized = nextNextM > 11 ? 0 : nextNextM
      const periodNextNextStart = new Date(nextNextY, nextNextMNormalized, Math.min(startDay, new Date(nextNextY, nextNextMNormalized + 1, 0).getDate()))
      const nextPeriodEnd = new Date(periodNextNextStart.getTime() - 24 * 60 * 60 * 1000)

      nextInvoice = {
        periodoDesde: formatDate(periodNextStart),
        periodoHasta: formatDate(nextPeriodEnd),
        nombrePlan: planName,
        monto: Number(nextMonto.toFixed(2)),
        fechaCreacion: formatDate(finalNextCreationDate),
        fechaVencimiento: formatDate(nextDueDate),
      }
    }

    return {
      firstInvoice,
      nextInvoice,
    }
  }


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

  useEffect(() => {
    if (open) {
      setStep(1)
      setErrorMessage(null)
      const today = new Date()
      const yyyy = today.getFullYear()
      const mm = String(today.getMonth() + 1).padStart(2, '0')
      const dd = String(today.getDate()).padStart(2, '0')
      const todayStr = `${yyyy}-${mm}-${dd}`

      if (client) {
        reset({
          id: client.id,
          last_name: client.last_name ?? '',
          first_name: client.first_name ?? '',
          name: client.name,
          document_type: client.cedula?.length === 13 ? 'ruc' : 'cedula',
          cedula: client.cedula,
          phone: client.phone,
          address: client.address,
          latitude: client.latitude,
          longitude: client.longitude,
          gateway_id: client.gateway_id,
          connection_type: client.connection_type,
          plan_id: client.plan_activo?.id ?? '',
          active: client.active,
          ip: client.static_ip?.ip ?? '',
          mac: client.static_ip?.mac ?? '',
          notes_ip: client.static_ip?.notes ?? '',
          ppp_username: client.pppoe_secret?.ppp_username ?? '',
          ppp_password: client.pppoe_secret?.ppp_password ?? '',
          profile_id: client.pppoe_secret?.profile_id ?? '',
          email: client.email ?? '',
          created_at: client.created_at ? client.created_at.split('T')[0] : todayStr,
          billing_start: client.billing_start
            ? client.billing_start.split('T')[0]
            : (client.created_at ? client.created_at.split('T')[0] : todayStr),
          billing_period_start_day: client.billing_period_start_day ?? 1,
          invoice_advance_days: client.invoice_advance_days ?? 0,
          billing_type: client.billing_type ?? 'forward',
          auto_apply_payment: client.auto_apply_payment ?? true,
          use_auto_credit: client.use_auto_credit ?? true,
          separate_proration: client.separate_proration ?? true,
          dia_pago: (() => {
            if (!client.billing_period_start_day || !client.created_at) return 'registro'
            const createdDay = new Date(client.created_at.split('T')[0] + 'T12:00:00').getDate()
            return client.billing_period_start_day === createdDay ? 'registro' : String(client.billing_period_start_day)
          })(),
          metodo_pago: 'transferencia',
          notif_email: true,
          notif_sms: false,
          notif_whatsapp: true,
          custom_service_ids: client.custom_services?.map((cs: any) => cs.id) ?? [],
        })
        {
          const initialItems = (client as any).inventory_items?.map((a: any) => ({
            inventory_item_id: a.inventory_item_id,
            item_name: a.item_name ?? '',
            item_code: a.item_code ?? '',
            quantity: a.quantity ?? 1,
            serial_number: a.serial_number ?? '',
            mac: a.mac ?? '',
            notes: a.notes ?? '',
          })) ?? []
          setSelectedInventoryItems(initialItems)
          initialInventoryItemsRef.current = JSON.stringify(initialItems)
        }
      } else {
        reset({
          id: undefined,
          last_name: '',
          first_name: '',
          name: '',
          document_type: 'cedula',
          cedula: '',
          phone: '',
          address: '',
          latitude: null,
          longitude: null,
          gateway_id: '',
          connection_type: 'static',
          plan_id: '',
          active: true,
          ip: '',
          mac: '',
          notes_ip: '',
          ppp_username: '',
          ppp_password: '',
          profile_id: '',
          email: '',
          created_at: todayStr,
          billing_start: todayStr,
          billing_period_start_day: 1,
          invoice_advance_days: 0,
          billing_type: 'forward',
          auto_apply_payment: true,
          use_auto_credit: true,
          separate_proration: true,
          dia_pago: 'registro',
          metodo_pago: 'transferencia',
          notif_email: true,
          notif_sms: false,
          notif_whatsapp: true,
          custom_service_ids: [],
        })
        setSelectedInventoryItems([])
        initialInventoryItemsRef.current = '[]'
        handleGetLocation()
      }
    }
  }, [open, client, reset, setValue, handleGetLocation])

  const saveMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const payload = { ...data } as any
      payload.name = `${payload.last_name || ''} ${payload.first_name || ''}`.trim()
      delete payload.last_name
      delete payload.first_name
      if (!payload.custom_service_ids) {
        payload.custom_service_ids = []
      }
      payload.inventory_items = selectedInventoryItems.map(item => ({
        inventory_item_id: item.inventory_item_id,
        quantity: item.quantity,
        serial_number: item.serial_number || null,
        mac: item.mac || null,
        notes: item.notes || null,
      }))
      delete payload.document_type
      delete payload.dia_pago
      delete payload.metodo_pago
      delete payload.notif_email
      delete payload.notif_sms
      delete payload.notif_whatsapp

      if (!payload.plan_id) delete payload.plan_id
      if (payload.latitude === 0 || isNaN(Number(payload.latitude))) payload.latitude = null
      if (payload.longitude === 0 || isNaN(Number(payload.longitude))) payload.longitude = null

      const phoneStr = payload.phone as string | null | undefined
      if (!phoneStr || phoneStr.trim() === '') {
        payload.phone = null
      }

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

      const billingStartStr = payload.billing_start as string | null | undefined
      if (!billingStartStr || billingStartStr.trim() === '') {
        payload.billing_start = null
      } else {
        payload.billing_start = `${billingStartStr}T12:00:00`
      }

      if (payload.connection_type === 'pppoe') {
        payload.ip = null
        payload.mac = null
        payload.notes_ip = null
      } else {
        payload.mac = null
        const notesIpStr = payload.notes_ip as string | null | undefined
        if (!notesIpStr || notesIpStr.trim() === '') payload.notes_ip = null
        payload.ppp_username = null
        payload.ppp_password = null
        payload.profile_id = null
      }

      if (isEdit) {
        const currentPlanId = client?.plan_activo?.id ?? ''
        const planIdToAssign = (payload.plan_id && payload.plan_id !== currentPlanId) ? payload.plan_id : null
        delete payload.plan_id
        await api.put(`/clients/${client!.id}`, payload)
        if (planIdToAssign) {
          await api.post(`/clients/${client!.id}/assign-plan`, null, { params: { plan_id: planIdToAssign } })
        }
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
        setValue('latitude', Number(e.latlng.lat.toFixed(6)))
        setValue('longitude', Number(e.latlng.lng.toFixed(6)))
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

    const step1Fields = ['last_name', 'first_name', 'document_type', 'cedula', 'phone', 'address', 'email', 'created_at', 'latitude', 'longitude']
    if (errorKeys.some((key) => step1Fields.includes(key))) {
      setStep(1)
      return
    }

    const step2Fields = ['dia_pago', 'metodo_pago', 'plan_id']
    if (errorKeys.some((key) => step2Fields.includes(key))) {
      setStep(2)
      return
    }

    const step3Fields = ['custom_service_ids']
    if (errorKeys.some((key) => step3Fields.includes(key))) {
      setStep(3)
      return
    }

    const step4Fields = ['gateway_id', 'connection_type', 'ip', 'mac', 'notes_ip', 'ppp_username', 'ppp_password', 'profile_id']
    if (errorKeys.some((key) => step4Fields.includes(key))) {
      setStep(4)
      return
    }

    const step5Fields = ['notif_email', 'notif_sms', 'notif_whatsapp']
    if (errorKeys.some((key) => step5Fields.includes(key))) {
      setStep(5)
      return
    }
  }

  if (!open) return null

  // Coordenadas iniciales para render del Marker
  const mapCenter: [number, number] = latVal && lngVal ? [latVal, lngVal] : DEFAULT_CENTER

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-6xl mx-4 animate-fade-in h-5/6 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-foreground">
            {isEdit ? `Editar: ${client.name}` : 'Registrar Nuevo Cliente'}
          </h2>
          <button
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
              onClick={() => setStep(1)}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                step === 1
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <User className="w-4 h-4" />
              Datos Personales
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                step === 2
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Layers className="w-4 h-4" />
              Servicios
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                step === 3
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              Facturación
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                step === 4
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Wifi className="w-4 h-4" />
              Red
            </button>
            <button
              type="button"
              onClick={() => setStep(5)}
              className={`px-5 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                step === 5
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Bell className="w-4 h-4" />
              Avisos
            </button>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit((data) => saveMutation.mutate(data), onFormError)} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
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

                {/* Apellidos y Nombres */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Apellidos *</label>
                    <input
                      type="text"
                      placeholder="Perez Garcia"
                      {...register('last_name')}
                      className="input-field"
                    />
                    {errors.last_name && <p className="text-xs text-destructive mt-1">{errors.last_name.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Nombres *</label>
                    <input
                      type="text"
                      placeholder="Juan Andres"
                      {...register('first_name')}
                      className="input-field"
                    />
                    {errors.first_name && <p className="text-xs text-destructive mt-1">{errors.first_name.message}</p>}
                  </div>
                </div>

                {/* Cédula/RUC y Teléfono */}
                <input type="hidden" {...register('document_type')} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Cédula / RUC *{' '}
                      {watchCedula && watchCedula.length > 0 && (
                        <span className="ml-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                          {watchDocType === 'ruc' ? 'RUC' : 'Cédula'}
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder="Cédula (10 dígitos) o RUC (13 dígitos)"
                      {...register('cedula')}
                      className="input-field font-mono"
                    />
                    {errors.cedula && <p className="text-xs text-destructive mt-1">{errors.cedula.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Teléfono </label>
                    <input
                      type="text"
                      placeholder="0999999999"
                      {...register('phone')}
                      className="input-field font-mono"
                    />
                    {errors.phone && <p className="text-xs text-destructive mt-1">{errors.phone.message}</p>}
                  </div>
                </div>

                {/* Correo Electrónico y Fecha de Registro */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Correo Electrónico *</label>
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
                    {...register('address')}
                    className="input-field"
                  />
                  {errors.address && <p className="text-xs text-destructive mt-1">{errors.address.message}</p>}
                </div>

                {/* Coordenadas GPS (Inputs manuales) */}
                <div className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3">
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
              </div>

              {/* Mapa interactivo a la derecha */}
              <div className="flex flex-col h-full min-h-[300px] lg:min-h-0">
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-brand-400" />
                    Ubicación en el Mapa
                  </span>

                  <div className="flex flex-wrap gap-2 w-full sm:w-auto items-center justify-end">
                    {/* Centrar por Router / Zona */}
                    <select
                      onChange={(e) => {
                        const rId = e.target.value
                        const gatewayObj = gateways.find((r) => r.id === rId)
                        if (gatewayObj && gatewayObj.latitude && gatewayObj.longitude) {
                          setValue('latitude', Number(gatewayObj.latitude))
                          setValue('longitude', Number(gatewayObj.longitude))
                        }
                      }}
                      className="bg-secondary/40 border border-border/60 text-[11px] text-foreground rounded px-2 py-1 font-sans cursor-pointer focus:outline-none focus:border-brand-500 max-w-[180px]"
                      defaultValue=""
                    >
                      <option value="" disabled>📍 Ir a Nodo / Router...</option>
                      {gateways
                        .filter((r) => r.latitude && r.longitude)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} {r.site_name ? `(${r.site_name})` : ''}
                          </option>
                        ))}
                    </select>

                    <button
                      type="button"
                      onClick={handleGetLocation}
                      className="text-[11px] bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 border border-brand-500/20 rounded px-2.5 py-1 transition-colors flex items-center gap-1 font-semibold"
                    >
                      <MapPin className="w-3.5 h-3.5 animate-pulse" />
                      Mi ubicación
                    </button>
                  </div>
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

          {/* PASO 2: SERVICIOS */}
          {step === 2 && (
            <div className="space-y-5 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <Layers className="w-4 h-4" /> Selección de Plan y Servicios Adicionales
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
                {/* Selección de Plan */}
                <div className="glass-card p-5 border border-border/60 bg-secondary/10 md:col-span-3 space-y-4">
                  {!isEdit ? (
                    <div>
                      <label className="block text-sm font-semibold text-brand-400 uppercase tracking-wider mb-2">
                        Plan de Internet inicial *
                      </label>
                      <select {...register('plan_id')} className="input-field cursor-pointer font-sans">
                        <option value="">Seleccione un plan inicial</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</option>
                        ))}
                      </select>
                      {errors.plan_id && <p className="text-xs text-destructive mt-1">{errors.plan_id.message}</p>}

                      {/* Detalle básico del plan seleccionado */}
                      {(() => {
                        const selectedPlanObj = plans.find((p) => p.id === selectedPlanId)
                        if (!selectedPlanObj) return null
                        return (
                          <div className="bg-brand-500/5 border border-brand-500/20 rounded-xl p-3.5 space-y-1.5 mt-3 animate-fade-in">
                            <div className="text-[10px] font-bold text-brand-300 uppercase tracking-wider">
                              Detalle del Plan
                            </div>
                            <div className="text-xs font-bold text-foreground">
                              {selectedPlanObj.name}
                            </div>
                            <div className="text-xs font-mono font-bold text-brand-400">
                              ${Number(selectedPlanObj.price).toFixed(2)}/mes
                            </div>
                            {(selectedPlanObj.speed_down_mbps !== undefined || selectedPlanObj.speed_up_mbps !== undefined) && (
                              <div className="text-[10px] text-muted-foreground flex gap-3 font-medium">
                                <span>📥 Down: {selectedPlanObj.speed_down_mbps || 0} Mbps</span>
                                <span>📤 Up: {selectedPlanObj.speed_up_mbps || 0} Mbps</span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="block text-sm font-semibold text-brand-400 uppercase tracking-wider">
                        Plan Contratado
                      </label>
                      {!client?.plan_activo && (
                        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 font-medium">
                          Sin plan activo — selecciona uno para asignarlo al guardar.
                        </div>
                      )}
                      <select {...register('plan_id')} className="input-field cursor-pointer font-sans">
                        {!client?.plan_activo && <option value="">Sin plan (asignar después)</option>}
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} (${Number(p.price).toFixed(2)})</option>
                        ))}
                      </select>

                      {client?.plan_activo && selectedPlanId && selectedPlanId !== client.plan_activo.id && (
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-[11px] text-amber-300 leading-relaxed">
                          ⚠️ Al guardar se cancelará el plan actual y se activará el nuevo de inmediato (con prorrateo), sincronizando el equipo del cliente.
                        </div>
                      )}

                      {(() => {
                        const selectedPlanObj = plans.find((p) => p.id === selectedPlanId)
                        if (!selectedPlanObj) return null
                        return (
                          <div className="bg-brand-500/5 border border-brand-500/20 rounded-xl p-3.5 space-y-1.5 animate-fade-in">
                            <div className="text-[10px] font-bold text-brand-300 uppercase tracking-wider">Detalle del Plan</div>
                            <div className="text-xs font-bold text-foreground">{selectedPlanObj.name}</div>
                            <div className="text-xs font-mono font-bold text-brand-400">${Number(selectedPlanObj.price).toFixed(2)}/mes</div>
                            {(selectedPlanObj.speed_down_mbps !== undefined || selectedPlanObj.speed_up_mbps !== undefined) && (
                              <div className="text-[10px] text-muted-foreground flex gap-3 font-medium">
                                <span>📥 Down: {selectedPlanObj.speed_down_mbps || 0} Mbps</span>
                                <span>📤 Up: {selectedPlanObj.speed_up_mbps || 0} Mbps</span>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* Fecha de corte */}
                  <div className="border-t border-border/40 pt-3 space-y-1.5">
                    <label className="block text-xs font-semibold text-brand-400 uppercase tracking-wider">
                      Fecha de corte
                    </label>
                    <select
                      value={watchDiaPago ?? 'registro'}
                      onChange={(e) => {
                        const val = e.target.value
                        setValue('dia_pago', val, { shouldDirty: true })
                        if (val === 'registro') {
                          if (watchCreatedAt) {
                            setValue('billing_period_start_day', new Date(watchCreatedAt + 'T12:00:00').getDate(), { shouldDirty: true })
                          }
                        } else {
                          setValue('billing_period_start_day', Number(val), { shouldDirty: true })
                        }
                      }}
                      className="input-field cursor-pointer font-sans text-sm"
                    >
                      <option value="registro">Fecha de registro del cliente</option>
                      {cutoffDates.map((dia) => (
                        <option key={dia} value={String(dia)}>Día {dia} de cada mes</option>
                      ))}
                    </select>
                    {watchDiaPago === 'registro' && watchCreatedAt ? (
                      <p className="text-[10px] text-brand-400">
                        → Día {new Date(watchCreatedAt + 'T12:00:00').getDate()} del mes (fecha de registro)
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">
                        Día del mes en que se genera el corte y envío de cobros.
                      </p>
                    )}
                  </div>
                </div>

                {/* Servicios de Valor Agregado */}
                <div className="glass-card p-5 border border-border/60 bg-secondary/10 md:col-span-2 space-y-4 overflow-y-auto max-h-[480px]">
                  <div>
                    <label className="block text-sm font-semibold text-brand-400 uppercase tracking-wider mb-1">
                      Servicios Adicionales
                    </label>
                    <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                      Busca y agrega servicios adicionales. Estos se sumarán al cobro de su plan mensual.
                    </p>
                  </div>

                  {customServices.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic bg-secondary/20 p-3 rounded-lg border border-border/40 text-center">
                      No hay servicios adicionales activos configurados en el catálogo.
                    </p>
                  ) : (
                    <>
                      {/* Buscador para agregar servicios */}
                      <div className="relative">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={serviceSearch}
                            onChange={(e) => {
                              setServiceSearch(e.target.value)
                              setShowServiceDropdown(true)
                            }}
                            onFocus={() => setShowServiceDropdown(true)}
                            placeholder="Buscar servicio para agregar..."
                            className="input-field pl-9 text-xs"
                          />
                        </div>

                        {showServiceDropdown && (() => {
                          const available = customServices.filter((cs) =>
                            !selectedCustomServiceIds.includes(cs.id) &&
                            cs.name.toLowerCase().includes(serviceSearch.toLowerCase())
                          )
                          return (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-secondary border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                              {available.length === 0 ? (
                                <div className="p-3 text-xs text-muted-foreground italic text-center">
                                  {selectedCustomServiceIds.length === customServices.length
                                    ? 'Ya se agregaron todos los servicios disponibles'
                                    : 'No se encontraron servicios'}
                                </div>
                              ) : (
                                available.map((cs) => (
                                  <button
                                    key={cs.id}
                                    type="button"
                                    onClick={() => {
                                      setValue('custom_service_ids', [...selectedCustomServiceIds, cs.id])
                                      setServiceSearch('')
                                      setShowServiceDropdown(false)
                                    }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-secondary-hover border-b border-border/30 last:border-b-0 flex items-center justify-between gap-2 text-xs cursor-pointer"
                                  >
                                    <span className="font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                                      <Plus className="w-3 h-3 text-brand-400 shrink-0" />
                                      {cs.name}
                                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.2 rounded border ${cs.recurring
                                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                        : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                                        }`}>
                                        {cs.recurring ? 'Mensual' : 'Pago Único'}
                                      </span>
                                    </span>
                                    <span className="text-[10px] font-mono font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded shrink-0">
                                      +${Number(cs.price).toFixed(2)}
                                    </span>
                                  </button>
                                ))
                              )}
                            </div>
                          )
                        })()}
                      </div>

                      {/* Servicios ya agregados */}
                      {selectedCustomServiceIds.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic font-sans">
                          Aún no se han agregado servicios adicionales.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {selectedCustomServiceIds.map((csId) => {
                            const cs = customServices.find((s) => s.id === csId)
                            if (!cs) return null
                            return (
                              <div
                                key={cs.id}
                                className="flex items-start justify-between gap-3 p-3 rounded-xl border border-brand-500/50 shadow-lg shadow-brand-500/5 bg-brand-500/5"
                              >
                                <div className="space-y-0.5">
                                  <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                                    {cs.name}
                                    <span className="text-[10px] font-mono font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded">
                                      +${Number(cs.price).toFixed(2)}
                                    </span>
                                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.2 rounded border ${cs.recurring
                                      ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                      : 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                                      }`}>
                                      {cs.recurring ? 'Mensual' : 'Pago Único'}
                                    </span>
                                  </span>
                                  {cs.description && (
                                    <span className="text-[11px] text-muted-foreground leading-normal block">
                                      {cs.description}
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setValue('custom_service_ids', selectedCustomServiceIds.filter((id) => id !== cs.id))
                                  }}
                                  className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PASO 3: FACTURACIÓN */}
          {step === 3 && (
            <div className="space-y-5 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <CreditCard className="w-4 h-4" /> Preferencias y Simulación de Facturación
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Panel Preferencias */}
                <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">

                  {/* Fecha de Inicio Facturación */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Inicio Facturación</label>
                      <input type="date" {...register('billing_start')} className="input-field font-sans text-xs cursor-pointer" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Día Inicio Período</label>
                      <input type="number" min="1" max="31" {...register('billing_period_start_day')} className="input-field font-mono text-xs font-bold" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Tipo de Facturación</label>
                      <select {...register('billing_type')} className="input-field font-sans text-xs cursor-pointer">
                        <option value="forward">Prepago</option>
                        <option value="backward">Postpago</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Anticipación (Días)</label>
                      <input type="number" min="0" {...register('invoice_advance_days')} className="input-field font-mono text-xs font-bold" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Método de Pago Habitual</label>
                    <select {...register('metodo_pago')} className="input-field cursor-pointer font-sans">
                      {methods.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="border-t border-border/40 pt-3 space-y-3">

                    {/* Usar crédito automáticamente */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-foreground block">Usar Crédito Automático</span>
                        <span className="text-[10px] text-muted-foreground">Consumir saldo a favor en facturas recurrentes</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input type="checkbox" {...register('use_auto_credit')} className="sr-only peer" />
                        <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </label>
                    </div>

                    {/* Prorrateo separado */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-semibold text-foreground block">Prorratear Inicial Separado</span>
                        <span className="text-[10px] text-muted-foreground">Facturar el período parcial de forma independiente</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input type="checkbox" {...register('separate_proration')} className="sr-only peer" />
                        <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Simulación de Facturación */}
                <div className="glass-card p-5 border border-border/60 bg-secondary/10 space-y-3 flex flex-col justify-between">
                  {(() => {
                    const { firstInvoice, nextInvoice } = getSimulation()
                    return (
                      <div className="space-y-3">
                        <div className="text-[11px] font-bold text-brand-400 uppercase tracking-wider">
                          Facturación Proyectada
                        </div>
                        <p className="text-[10px] text-muted-foreground -mt-2">
                          {dueDateSettings?.billing_due_mode === 'cutoff_date'
                            ? 'Vencimiento = fecha de corte del cliente (Ajustes → Facturación).'
                            : `Vencimiento = emisión + ${dueDateSettings?.billing_default_grace_days ?? 10} días (Ajustes → Facturación).`}
                        </p>

                        {/* Primera factura después del cambio */}
                        <div className="bg-brand-500/10 border border-brand-500/20 rounded-xl p-3.5 space-y-2">
                          <div className="flex justify-between items-center pb-1.5 border-b border-brand-500/10">
                            <span className="text-[10px] font-bold text-brand-300 uppercase">
                              Primera factura después del cambio
                            </span>
                            <span className="text-sm font-mono font-black text-brand-400">
                              ${firstInvoice.monto.toFixed(2)}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-y-1 text-[10px] text-muted-foreground">
                            <span>Plan:</span>
                            <span className="text-right text-foreground font-medium">{firstInvoice.nombrePlan}</span>

                            <span>Período:</span>
                            <span className="text-right text-foreground font-mono">
                              {firstInvoice.periodoDesde} al {firstInvoice.periodoHasta}
                            </span>

                            <span>Fecha Emisión:</span>
                            <span className="text-right text-foreground font-mono">{firstInvoice.fechaCreacion}</span>

                            <span>Fecha Vencimiento:</span>
                            <span className="text-right text-foreground font-mono">{firstInvoice.fechaVencimiento}</span>

                            <span>Fecha de Corte:</span>
                            <span className="text-right text-foreground font-mono">
                              {watchDiaPago === 'registro'
                              ? watchCreatedAt
                                ? `Día ${new Date(watchCreatedAt + 'T12:00:00').getDate()}`
                                : 'Fecha de registro'
                              : watchDiaPago
                                ? `Día ${watchDiaPago} de cada mes`
                                : '—'}
                              </span>
                          </div>
                        </div>

                        {/* Facturas siguientes */}
                        <div className="bg-secondary/10 border border-border/40 rounded-xl p-3.5 space-y-2">
                          <div className="flex justify-between items-center pb-1.5 border-b border-border/20">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">
                              Facturas siguientes
                            </span>
                            <span className="text-sm font-mono font-bold text-foreground">
                              ${nextInvoice.monto.toFixed(2)}/mes
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-y-1 text-[10px] text-muted-foreground">
                            <span>Plan:</span>
                            <span className="text-right text-foreground font-medium">{nextInvoice.nombrePlan}</span>

                            <span>Período Estimado:</span>
                            <span className="text-right text-foreground font-mono">
                              {nextInvoice.periodoDesde} al {nextInvoice.periodoHasta}
                            </span>

                            <span>Fecha Emisión:</span>
                            <span className="text-right text-foreground font-mono">{nextInvoice.fechaCreacion}</span>

                            <span>Fecha Vencimiento:</span>
                            <span className="text-right text-foreground font-mono">{nextInvoice.fechaVencimiento}</span>

                            <span>Fecha de Corte:</span>
                            <span className="text-right text-foreground font-mono">
                              {watchDiaPago === 'registro'
                              ? watchCreatedAt
                                ? `Día ${new Date(watchCreatedAt + 'T12:00:00').getDate()}`
                                : 'Fecha de registro'
                              : watchDiaPago
                                ? `Día ${watchDiaPago} de cada mes`
                                : '—'}
                              </span>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* PASO 4: RED */}
          {step === 4 && (
            <div className="space-y-5 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                <Wifi className="w-4 h-4" /> Configuración de Red e Internet
              </div>

              <div className="glass-card p-6 border border-border/60 space-y-4 bg-secondary/10">
                {/* Gateway y Tipo de Conexión */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-sans">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Gateway *</label>
                    <select {...register('gateway_id')} className="input-field cursor-pointer font-sans">
                      <option value="">Seleccione gateway</option>
                      {gateways.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} ({r.ip})</option>
                      ))}
                    </select>
                    {errors.gateway_id && <p className="text-xs text-destructive mt-1">{errors.gateway_id.message}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Tipo de Conexión *</label>
                    <select {...register('connection_type')} className="input-field cursor-pointer font-sans">
                      <option value="static">IP Estática</option>
                      <option value="pppoe">PPPoE</option>
                    </select>
                    {errors.connection_type && <p className="text-xs text-destructive mt-1">{errors.connection_type.message}</p>}
                  </div>
                </div>

                {/* Campos condicionales para IP Estática */}
                {watch('connection_type') === 'static' && (
                  <div className="space-y-4 border-l-2 border-brand-500 pl-4 py-1.5 mt-2 bg-brand-500/5 rounded-r-lg pr-3">
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
                      <label className="block text-sm font-medium text-foreground mb-1.5">Notas de Red</label>
                      <input
                        type="text"
                        placeholder="Ej: Puerto switch #3, VLAN 10, etc."
                        {...register('notes_ip')}
                        className="input-field"
                      />
                    </div>
                  </div>
                )}

                {/* Campos condicionales para PPPoE */}
                {watch('connection_type') === 'pppoe' && (
                  <div className="space-y-4 border-l-2 border-brand-500 pl-4 py-1.5 mt-2 bg-brand-500/5 rounded-r-lg pr-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Usuario PPPoE *</label>
                        <input
                          type="text"
                          placeholder="juan.perez"
                          {...register('ppp_username')}
                          className="input-field font-mono"
                        />
                        {errors.ppp_username && <p className="text-xs text-destructive mt-1">{errors.ppp_username.message}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Contraseña PPPoE *</label>
                        <input
                          type="text"
                          placeholder="p4ssw0rd"
                          {...register('ppp_password')}
                          className="input-field font-mono"
                        />
                        {errors.ppp_password && <p className="text-xs text-destructive mt-1">{errors.ppp_password.message}</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sección de equipos de inventario */}
              <div className="glass-card p-6 border border-border/60 space-y-4 bg-secondary/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                    <Package className="w-4 h-4" /> Equipos Asignados
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddEquipment(true)
                      setNewEquipmentItemId('')
                      setNewEquipmentQuantity(1)
                      setNewEquipmentSerial('')
                      setNewEquipmentMac('')
                      setNewEquipmentNotes('')
                    }}
                    className="btn-secondary text-xs px-2.5 py-1.5 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar
                  </button>
                </div>

                {selectedInventoryItems.length === 0 && !showAddEquipment && (
                  <p className="text-xs text-muted-foreground italic font-sans">
                    No hay equipos asignados a este cliente.
                  </p>
                )}

                {selectedInventoryItems.length > 0 && (
                  <div className="space-y-2">
                    {selectedInventoryItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between p-3 rounded-lg bg-secondary/30 border border-border/40"
                      >
                        <div className="text-xs space-y-0.5">
                          <p className="font-semibold text-foreground">
                            {item.item_name}
                            <span className="text-muted-foreground font-normal font-mono ml-1.5">#{item.item_code}</span>
                          </p>
                          <p className="text-muted-foreground font-sans">
                            Cant: <span className="text-foreground font-medium">{item.quantity}</span>
                            {item.serial_number && <> · Serie: <span className="font-mono text-foreground">{item.serial_number}</span></>}
                            {item.mac && <> · MAC: <span className="font-mono text-foreground">{item.mac}</span></>}
                            {item.notes && <> · {item.notes}</>}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedInventoryItems(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mini-formulario para agregar equipo */}
                {showAddEquipment && (
                  <div className="p-4 rounded-lg border border-brand-500/30 bg-brand-500/5 space-y-3">
                    <select
                      value={newEquipmentItemId}
                      onChange={(e) => setNewEquipmentItemId(e.target.value)}
                      className="input-field text-xs cursor-pointer font-sans w-full"
                    >
                      <option value="">-- Seleccionar artículo del inventario --</option>
                      {inventoryItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.code}){item.model ? ` — ${item.model}` : ''} · Stock: {item.quantity}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground font-semibold uppercase">Cantidad</label>
                        <input
                          type="number"
                          min={1}
                          value={newEquipmentQuantity}
                          onChange={(e) => setNewEquipmentQuantity(Number(e.target.value))}
                          className="input-field text-xs mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground font-semibold uppercase">N° Serie</label>
                        <input
                          type="text"
                          value={newEquipmentSerial}
                          onChange={(e) => setNewEquipmentSerial(e.target.value)}
                          placeholder="SN123456"
                          className="input-field text-xs font-mono mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground font-semibold uppercase">MAC</label>
                        <input
                          type="text"
                          value={newEquipmentMac}
                          onChange={(e) => setNewEquipmentMac(e.target.value)}
                          placeholder="AA:BB:CC:DD:EE:FF"
                          className="input-field text-xs font-mono mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-semibold uppercase">Notas</label>
                      <input
                        type="text"
                        value={newEquipmentNotes}
                        onChange={(e) => setNewEquipmentNotes(e.target.value)}
                        placeholder="Ubicación, estado, etc."
                        className="input-field text-xs mt-1"
                      />
                    </div>
                    <div className="flex gap-2 justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddEquipment(false)}
                        className="btn-secondary text-xs px-3 py-1.5 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={!newEquipmentItemId}
                        onClick={() => {
                          const found = inventoryItems.find(i => i.id === newEquipmentItemId)
                          if (!found) return
                          setSelectedInventoryItems(prev => [...prev, {
                            inventory_item_id: found.id,
                            item_name: found.name,
                            item_code: found.code,
                            quantity: newEquipmentQuantity,
                            serial_number: newEquipmentSerial,
                            mac: newEquipmentMac,
                            notes: newEquipmentNotes,
                          }])
                          setShowAddEquipment(false)
                        }}
                        className="btn-primary text-xs px-3 py-1.5 cursor-pointer disabled:opacity-50"
                      >
                        Agregar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PASO 5: AVISOS */}
          {step === 5 && (
            <div className="space-y-6 max-w-3xl mx-auto py-4 animate-fade-in">
              <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl p-4 flex gap-3.5 items-start">
                <div className="p-2 bg-brand-500/20 text-brand-400 rounded-lg shrink-0">
                  <Bell className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-brand-300">Configuración de Avisos y Notificaciones</h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed font-sans font-medium">
                    Este módulo se encuentra en fase de diseño técnico. Las opciones seleccionadas a continuación
                    servirán como pre-configuración y se vincularán automáticamente cuando se active la pasarela
                    de notificaciones automáticas y alertas.
                  </p>
                </div>
              </div>

              <div className="glass-card p-5 border border-border/60 space-y-4 bg-secondary/10">
                <div className="flex items-center gap-2 text-brand-400 text-xs font-semibold uppercase tracking-wider">
                  <Bell className="w-4 h-4" /> Canales de Notificación Activos
                </div>

                <p className="text-xs text-muted-foreground font-sans font-medium">
                  Seleccione los medios por los cuales el cliente recibirá estados de cuenta, alertas de pago y avisos de mantenimiento.
                </p>

                <div className="space-y-3.5 pt-2">
                  {/* Canal WhatsApp */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border/40">
                    <div className="flex items-center gap-3 font-sans">
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
                    <div className="flex items-center gap-3 font-sans">
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
                    <div className="flex items-center gap-3 font-sans">
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
          )}
        </div>

          {/* Acciones del Modal */}
          <div className="flex justify-between items-center border-t border-border/50 px-5 py-4 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary w-32 justify-center"
            >
              Cancelar
            </button>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saveMutation.isPending || (isEdit && !hasChanges)}
                title={isEdit && !hasChanges ? 'No hay cambios por guardar' : undefined}
                className={`w-44 justify-center cursor-pointer font-sans font-semibold transition-all duration-200 ${isEdit && !hasChanges
                  ? 'btn-secondary opacity-60 cursor-not-allowed'
                  : 'btn-primary ring-2 ring-brand-400/60 shadow-lg shadow-brand-500/30'
                  }`}
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {saveMutation.isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Registrar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
