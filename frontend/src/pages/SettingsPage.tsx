/**
 * SettingsPage — Página exclusiva para configuraciones globales (MikroTik, Datos de la Empresa, Facturación, Suspensión, Métodos de Pago, Usuarios y Alertas).
 */
import React, { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Save, SlidersHorizontal, CheckCircle2, XCircle, Building, Users, Bell, Loader2,
  Globe, Phone, MapPin, Hash, Mail, Upload, Receipt, Ban, CreditCard, Plus, Trash2,
  Edit2, Check, X, Shield, Clock, Router, UserPlus, ToggleLeft, ToggleRight
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Navigate } from 'react-router-dom'
import api from '@/services/api'
import { getLogoUrl } from '@/components/AppLayout'

// ── Zod Schemas ──────────────────────────────────────────────────────────────
const companySchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  ruc: z.string().max(20).optional().or(z.literal('')),
  direccion: z.string().max(255).optional().or(z.literal('')),
  telefono: z.string().max(40).optional().or(z.literal('')),
  email: z.string().email('Correo inválido').optional().or(z.literal('')).or(z.null()),
  sitio_web: z.string().max(255).optional().or(z.literal('')),
  logo_url: z.string().max(255).optional().or(z.literal('')).or(z.null()),
})

type CompanyFormData = z.infer<typeof companySchema>

interface PaymentMethod {
  value: string
  label: string
  isSystem?: boolean
}

interface UserItem {
  id: string
  nombre: string
  email: string
  rol: 'admin' | 'tecnico' | 'viewer'
  activo: boolean
  inactivity_timeout: number
  tipo_operador?: string
  permisos_router?: string
  horario_acceso?: string
  permisos?: string
  created_at: string
}

const userSchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  email: z.string().email('Email inválido'),
  password: z.string().optional().or(z.literal('')),
  rol: z.enum(['admin', 'tecnico', 'viewer']),
  tipo_operador: z.string(),
  activo: z.boolean().default(true),
  inactivity_timeout: z.coerce.number().default(0),
  horario_inicio: z.string().default('00:00'),
  horario_fin: z.string().default('23:59'),
})

type UserFormData = z.infer<typeof userSchema>

const DISPONIBLE_PERMISOS = [
  { value: 'clientes:ver', label: 'Ver Clientes' },
  { value: 'clientes:crear', label: 'Registrar/Editar Clientes' },
  { value: 'pagos:registrar', label: 'Registrar Pagos/Cobros' },
  { value: 'facturas:administrar', label: 'Administrar Facturas' },
  { value: 'inventario:administrar', label: 'Administrar Stock/Inventario' },
  { value: 'routers:administrar', label: 'Administrar Routers' },
]

type TabType = 'general' | 'company' | 'gateway' | 'users' | 'alerts' | 'billing'
type NavItem = { id: TabType; icon: React.ComponentType<{ className?: string }>; label: string }

export function SettingsPage() {
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.rol === 'admin'
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<TabType>('general')
  const [generalSubTab, setGeneralSubTab] = useState<'billing' | 'suspension' | 'payment_methods'>('billing')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)


  // Estados para Métodos de Pago
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [newMethodLabel, setNewMethodLabel] = useState('')
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  // Estados para listas MikroTik (Colas Padre y Address Lists)
  const [colasPadre, setColasPadre] = useState<string[]>([])
  const [newColaPadre, setNewColaPadre] = useState('')
  const [editingColaPadre, setEditingColaPadre] = useState<string | null>(null)
  const [editingColaPadreVal, setEditingColaPadreVal] = useState('')

  const [addressLists, setAddressLists] = useState<string[]>([])
  const [newAddressList, setNewAddressList] = useState('')
  const [editingAddressList, setEditingAddressList] = useState<string | null>(null)
  const [editingAddressListVal, setEditingAddressListVal] = useState('')

  // Estados para Modal de Usuario
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [selectedRouters, setSelectedRouters] = useState<string[]>([])
  const [selectedPermisos, setSelectedPermisos] = useState<string[]>([])

  // Redirigir si no es administrador
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  // Cargar Métodos de Pago al activar pestaña
  useEffect(() => {
    if (activeTab === 'billing' && generalSubTab === 'payment_methods') {
      const saved = localStorage.getItem('wisp_payment_methods')
      const defaults: PaymentMethod[] = [
        { value: 'efectivo', label: 'Efectivo', isSystem: true },
        { value: 'transferencia', label: 'Transferencia', isSystem: true },
        { value: 'tarjeta', label: 'Tarjeta', isSystem: true },
        { value: 'deposito', label: 'Depósito', isSystem: true }
      ]
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as PaymentMethod[]
          const loaded = parsed.map(p => {
            if (['efectivo', 'transferencia', 'tarjeta', 'deposito'].includes(p.value)) {
              return { ...p, isSystem: true }
            }
            return p
          })
          setPaymentMethods(loaded)
        } catch (e) {
          setPaymentMethods(defaults)
        }
      } else {
        setPaymentMethods(defaults)
        localStorage.setItem('wisp_payment_methods', JSON.stringify(defaults))
      }
    }
  }, [activeTab, generalSubTab])

  // Cargar listas MikroTik (Colas Padre y Address Lists) al activar pestaña
  useEffect(() => {
    if (activeTab === 'gateway') {
      const savedColas = localStorage.getItem('wisp_colas_padre')
      setColasPadre(savedColas ? JSON.parse(savedColas) : [])
      const savedAL = localStorage.getItem('wisp_address_lists')
      setAddressLists(savedAL ? JSON.parse(savedAL) : [])
    }
  }, [activeTab])


  // ── Handlers Colas Padre ────────────────────────────────────────────────────
  const handleAddColaPadre = (e: React.FormEvent) => {
    e.preventDefault()
    const val = newColaPadre.trim()
    if (!val) return
    if (colasPadre.includes(val)) {
      setStatusMessage({ type: 'error', text: 'Esa cola padre ya existe.' }); return
    }
    const updated = [...colasPadre, val]
    setColasPadre(updated)
    localStorage.setItem('wisp_colas_padre', JSON.stringify(updated))
    setNewColaPadre('')
    setStatusMessage({ type: 'success', text: `Cola padre "${val}" agregada.` })
  }
  const handleDeleteColaPadre = (val: string) => {
    const updated = colasPadre.filter(c => c !== val)
    setColasPadre(updated)
    localStorage.setItem('wisp_colas_padre', JSON.stringify(updated))
    setStatusMessage({ type: 'success', text: 'Cola padre eliminada.' })
  }
  const handleSaveColaPadre = (old: string) => {
    const val = editingColaPadreVal.trim()
    if (!val) return
    const updated = colasPadre.map(c => c === old ? val : c)
    setColasPadre(updated)
    localStorage.setItem('wisp_colas_padre', JSON.stringify(updated))
    setEditingColaPadre(null)
    setStatusMessage({ type: 'success', text: 'Cola padre actualizada.' })
  }

  // ── Handlers Address Lists ──────────────────────────────────────────────────
  const handleAddAddressList = (e: React.FormEvent) => {
    e.preventDefault()
    const val = newAddressList.trim()
    if (!val) return
    if (addressLists.includes(val)) {
      setStatusMessage({ type: 'error', text: 'Esa Address List ya existe.' }); return
    }
    const updated = [...addressLists, val]
    setAddressLists(updated)
    localStorage.setItem('wisp_address_lists', JSON.stringify(updated))
    setNewAddressList('')
    setStatusMessage({ type: 'success', text: `Address List "${val}" agregada.` })
  }
  const handleDeleteAddressList = (val: string) => {
    const updated = addressLists.filter(a => a !== val)
    setAddressLists(updated)
    localStorage.setItem('wisp_address_lists', JSON.stringify(updated))
    setStatusMessage({ type: 'success', text: 'Address List eliminada.' })
  }
  const handleSaveAddressList = (old: string) => {
    const val = editingAddressListVal.trim()
    if (!val) return
    const updated = addressLists.map(a => a === old ? val : a)
    setAddressLists(updated)
    localStorage.setItem('wisp_address_lists', JSON.stringify(updated))
    setEditingAddressList(null)
    setStatusMessage({ type: 'success', text: 'Address List actualizada.' })
  }

  // ── Formulario de Empresa ───────────────────────────────────────────────────
  const {
    data: companyData,
    isLoading: loadingCompany,
  } = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const { data } = await api.get('/company')
      return data
    },
    enabled: activeTab === 'company',
  })

  const {
    register: registerCompany,
    handleSubmit: handleSubmitCompany,
    reset: resetCompany,
    setValue: setValueCompany,
    watch: watchCompany,
    formState: { errors: companyErrors },
  } = useForm<CompanyFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(companySchema) as any,
  })

  const watchLogoUrl = watchCompany('logo_url')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [showManualUrl, setShowManualUrl] = useState(false)

  useEffect(() => {
    if (companyData) {
      resetCompany({
        nombre: companyData.nombre,
        ruc: companyData.ruc || '',
        direccion: companyData.direccion || '',
        telefono: companyData.telefono || '',
        email: companyData.email || '',
        sitio_web: companyData.sitio_web || '',
        logo_url: companyData.logo_url || '',
      })
      if (companyData.logo_url && (companyData.logo_url.startsWith('http://') || companyData.logo_url.startsWith('https://'))) {
        setShowManualUrl(true)
      }
    }
  }, [companyData, resetCompany])

  const companyMutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      const cleanData = { ...data }
      if (cleanData.email === '') cleanData.email = null
      if (cleanData.logo_url === '') cleanData.logo_url = null
      await api.put('/company', cleanData)
    },
    onSuccess: () => {
      setStatusMessage({ type: 'success', text: 'Datos de la empresa actualizados exitosamente' })
      queryClient.invalidateQueries({ queryKey: ['company'] })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      const errMsg = err?.response?.data?.detail || 'Error al actualizar los datos de la empresa'
      setStatusMessage({ type: 'error', text: errMsg })
    },
  })

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
    if (!validTypes.includes(file.type)) {
      setStatusMessage({
        type: 'error',
        text: 'Solo se permiten imágenes (PNG, JPG, JPEG, WEBP, SVG)',
      })
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    setUploadingLogo(true)
    setStatusMessage(null)

    try {
      const { data } = await api.post('/company/logo', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      setValueCompany('logo_url', data.logo_url)
      queryClient.invalidateQueries({ queryKey: ['company'] })
      setStatusMessage({ type: 'success', text: 'Logo de la empresa subido correctamente' })
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || 'Error al subir el logo'
      setStatusMessage({ type: 'error', text: errMsg })
    } finally {
      setUploadingLogo(false)
      e.target.value = ''
    }
  }

  // Metodos de pago handlers
  const handleAddPaymentMethod = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMethodLabel.trim()) return

    const cleanLabel = newMethodLabel.trim()
    const cleanValue = cleanLabel
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/(^_|_$)/g, '')

    if (!cleanValue) {
      setStatusMessage({ type: 'error', text: 'El nombre del método de pago no es válido.' })
      return
    }

    if (paymentMethods.some(p => p.value === cleanValue)) {
      setStatusMessage({ type: 'error', text: 'Este método de pago ya existe.' })
      return
    }

    const updated = [...paymentMethods, { value: cleanValue, label: cleanLabel }]
    setPaymentMethods(updated)
    localStorage.setItem('wisp_payment_methods', JSON.stringify(updated))
    setNewMethodLabel('')
    setStatusMessage({ type: 'success', text: `Método de pago "${cleanLabel}" agregado correctamente.` })
  }

  const handleDeletePaymentMethod = (valueToDelete: string) => {
    const method = paymentMethods.find(p => p.value === valueToDelete)
    if (method?.isSystem) {
      setStatusMessage({ type: 'error', text: 'No se pueden eliminar los métodos del sistema por defecto.' })
      return
    }

    const updated = paymentMethods.filter(p => p.value !== valueToDelete)
    setPaymentMethods(updated)
    localStorage.setItem('wisp_payment_methods', JSON.stringify(updated))
    setStatusMessage({ type: 'success', text: 'Método de pago eliminado correctamente.' })
  }

  const handleSaveEdit = (value: string) => {
    if (!editingLabel.trim()) return

    const updated = paymentMethods.map(p => {
      if (p.value === value) {
        return { ...p, label: editingLabel.trim() }
      }
      return p
    })

    setPaymentMethods(updated)
    localStorage.setItem('wisp_payment_methods', JSON.stringify(updated))
    setEditingValue(null)
    setStatusMessage({ type: 'success', text: 'Método de pago actualizado correctamente.' })
  }

  // ── Gestión de Usuarios: Data Fetching ─────────────────────────────────────────
  const { data: usersList = [], refetch: refetchUsers, isLoading: loadingUsers } = useQuery<UserItem[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return data
    },
    enabled: activeTab === 'users',
  })

  const { data: routers = [] } = useQuery<{ id: string; nombre: string }[]>({
    queryKey: ['routers-list-settings'],
    queryFn: async () => {
      const { data } = await api.get('/gateways')
      return data
    },
    enabled: activeTab === 'users',
  })


  const {
    register: registerUser,
    handleSubmit: handleSubmitUser,
    reset: resetUser,
    setValue: setValueUser,
    watch: watchUser,
    formState: { errors: userErrors },
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema) as any,
    defaultValues: {
      rol: 'viewer',
      tipo_operador: 'soporte_tecnico',
      activo: true,
      inactivity_timeout: 0,
      horario_inicio: '00:00',
      horario_fin: '23:59',
    }
  })

  const watchOperatorType = watchUser('tipo_operador')

  // Auto-map operator type to standard role and default permissions
  useEffect(() => {
    if (watchOperatorType === 'administrador') {
      setValueUser('rol', 'admin')
      setSelectedPermisos(DISPONIBLE_PERMISOS.map(p => p.value))
    } else if (watchOperatorType === 'operador_pagos') {
      setValueUser('rol', 'viewer')
      setSelectedPermisos(['pagos:registrar', 'clientes:ver'])
    } else if (watchOperatorType === 'instalador') {
      setValueUser('rol', 'tecnico')
      setSelectedPermisos(['clientes:ver', 'clientes:crear'])
    } else if (watchOperatorType === 'soporte_tecnico') {
      setValueUser('rol', 'tecnico')
      setSelectedPermisos(['clientes:ver', 'clientes:crear', 'routers:administrar'])
    }
  }, [watchOperatorType, setValueUser])

  const userMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const payload: any = {
        nombre: data.nombre,
        email: data.email,
        rol: data.rol,
        activo: data.activo,
        inactivity_timeout: data.inactivity_timeout,
        tipo_operador: data.tipo_operador,
        permisos_router: selectedRouters.join(','),
        horario_acceso: `${data.horario_inicio}-${data.horario_fin}`,
        permisos: selectedPermisos.join(','),
      }

      if (data.password && data.password.trim() !== '') {
        payload.password = data.password
      }

      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, payload)
      } else {
        if (!data.password) {
          throw new Error('La contraseña es obligatoria para nuevos usuarios')
        }
        await api.post('/users', payload)
      }
    },
    onSuccess: () => {
      setStatusMessage({
        type: 'success',
        text: editingUser ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.'
      })
      setIsUserModalOpen(false)
      setEditingUser(null)
      refetchUsers()
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.message || 'Error al guardar usuario'
      setStatusMessage({ type: 'error', text: msg })
    }
  })

  const handleOpenCreateUser = () => {
    setEditingUser(null)
    resetUser({
      nombre: '',
      email: '',
      password: '',
      rol: 'viewer',
      tipo_operador: 'soporte_tecnico',
      activo: true,
      inactivity_timeout: 0,
      horario_inicio: '08:00',
      horario_fin: '18:00',
    })
    setSelectedRouters([])
    setSelectedPermisos(['clientes:ver', 'clientes:crear', 'routers:administrar'])
    setIsUserModalOpen(true)
  }

  const handleOpenEditUser = (u: UserItem) => {
    setEditingUser(u)
    let start = '00:00'
    let end = '23:59'
    if (u.horario_acceso && u.horario_acceso.includes('-')) {
      const split = u.horario_acceso.split('-')
      start = split[0]
      end = split[1]
    }
    resetUser({
      nombre: u.nombre,
      email: u.email,
      password: '',
      rol: u.rol,
      tipo_operador: u.tipo_operador || 'soporte_tecnico',
      activo: u.activo,
      inactivity_timeout: u.inactivity_timeout,
      horario_inicio: start,
      horario_fin: end,
    })
    setSelectedRouters(u.permisos_router ? u.permisos_router.split(',') : [])
    setSelectedPermisos(u.permisos ? u.permisos.split(',') : [])
    setIsUserModalOpen(true)
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('¿Está seguro de eliminar este operador del sistema?')) return
    try {
      await api.delete(`/users/${id}`)
      setStatusMessage({ type: 'success', text: 'Operador eliminado exitosamente.' })
      refetchUsers()
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: 'Error al eliminar usuario.' })
    }
  }

  const handleToggleUserStatus = async (u: UserItem) => {
    try {
      await api.put(`/users/${u.id}`, { activo: !u.activo })
      setStatusMessage({ type: 'success', text: `Estado del usuario actualizado.` })
      refetchUsers()
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: 'Fallo al actualizar estado.' })
    }
  }

  // ── Tab navigation groups ────────────────────────────────────────────────
  const navItems: NavItem[] = [
    { id: 'general', icon: SlidersHorizontal, label: 'Ajustes Generales' },
    { id: 'company', icon: Building, label: 'Datos de la Empresa' },
    { id: 'gateway', icon: Router, label: 'Ajustes Gateway' },
    { id: 'billing', icon: Receipt, label: 'Facturación' },
    { id: 'users', icon: Users, label: 'Operadores' },
    { id: 'alerts', icon: Bell, label: 'Alertas' },
  ]

  const activeLabel = navItems.find(i => i.id === activeTab)?.label ?? ''

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Ajustes del ISP</h1>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-56 flex-shrink-0 sticky top-6">
          <nav className="glass-card p-2 space-y-1">
            {navItems.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setStatusMessage(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-left ${activeTab === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Right Content Panel ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Breadcrumb / Section title */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Ajustes</span>
            <span>/</span>
            <span className="text-foreground font-medium">{activeLabel}</span>
          </div>


          {/* Status Alert */}
          {statusMessage && (
            <div
              className={`rounded-xl p-4 flex items-start gap-3 border ${statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-destructive/10 border-destructive/30 text-destructive'
                }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <p className="text-sm font-medium">{statusMessage.text}</p>
            </div>
          )}
          {/* ── Tab Content: Ajustes Generales ───────────────────────────────────── */}
          {activeTab === 'general' && (
            <div className="glass-card p-12 text-center max-w-xl mx-auto space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto border border-primary/25">
                <SlidersHorizontal className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Ajustes Generales</h3>
              <p className="text-muted-foreground text-sm">
                Próximamente
              </p>
            </div>
          )}

          {/* ── Tab Content: Company ──────────────────────────────────────────────── */}
          {activeTab === 'company' && (
            <div className="glass-card p-6">
              <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
                <Building className="w-4 h-4 text-brand-400" />
                Información Corporativa de la Empresa
              </h2>

              {loadingCompany ? (
                <div className="flex items-center justify-center h-48">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Cargando datos de la empresa...</span>
                  </div>
                </div>
              ) : (
                <form
                  id="company-form"
                  onSubmit={handleSubmitCompany((data) => companyMutation.mutate(data))}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Razón Social */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Razón Social (Nombre) *</label>
                      <div className="relative">
                        <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          id="company-nombre"
                          type="text"
                          {...registerCompany('nombre')}
                          className="input-field pl-10"
                          placeholder="Mi WISP S.A."
                        />
                      </div>
                      {companyErrors.nombre && (
                        <p className="text-xs text-destructive mt-1">{companyErrors.nombre.message}</p>
                      )}
                    </div>

                    {/* RUC */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">RUC (Registro Único de Contribuyentes)</label>
                      <div className="relative">
                        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          id="company-ruc"
                          type="text"
                          {...registerCompany('ruc')}
                          className="input-field pl-10 font-mono"
                          placeholder="1790000000001"
                        />
                      </div>
                      {companyErrors.ruc && (
                        <p className="text-xs text-destructive mt-1">{companyErrors.ruc.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Teléfono */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Teléfono de Contacto</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          id="company-telefono"
                          type="text"
                          {...registerCompany('telefono')}
                          className="input-field pl-10"
                          placeholder="+593 2-123-4567 o +593 99 999 9999"
                        />
                      </div>
                      {companyErrors.telefono && (
                        <p className="text-xs text-destructive mt-1">{companyErrors.telefono.message}</p>
                      )}
                    </div>

                    {/* Correo */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Correo de Facturación/Contacto</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          id="company-email"
                          type="email"
                          {...registerCompany('email')}
                          className="input-field pl-10"
                          placeholder="facturacion@miwisp.com"
                        />
                      </div>
                      {companyErrors.email && (
                        <p className="text-xs text-destructive mt-1">{companyErrors.email.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Dirección */}
                    <div className="col-span-1 md:col-span-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">Dirección Principal</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          id="company-direccion"
                          type="text"
                          {...registerCompany('direccion')}
                          className="input-field pl-10"
                          placeholder="Av. Principal N34-12 y Calle Secundaria, Quito, Ecuador"
                        />
                      </div>
                      {companyErrors.direccion && (
                        <p className="text-xs text-destructive mt-1">{companyErrors.direccion.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Sitio Web */}
                    <div className="col-span-1 md:col-span-2">
                      <label className="block text-sm font-medium text-foreground mb-1.5">Sitio Web</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                          id="company-sitio-web"
                          type="text"
                          {...registerCompany('sitio_web')}
                          className="input-field pl-10 font-mono"
                          placeholder="https://www.miwisp.com"
                        />
                      </div>
                      {companyErrors.sitio_web && (
                        <p className="text-xs text-destructive mt-1">{companyErrors.sitio_web.message}</p>
                      )}
                    </div>
                  </div>

                  {/* Logo Section */}
                  <div className="col-span-1 md:col-span-2 p-4 rounded-xl bg-background/30 border border-border/50 backdrop-blur-md">
                    <label className="block text-sm font-medium text-foreground mb-3">
                      Logotipo de la Empresa
                    </label>
                    <div className="flex flex-col sm:flex-row items-center gap-6">
                      {/* Preview Area */}
                      <div className="relative group w-24 h-24 rounded-full overflow-hidden border-2 border-primary/30 flex items-center justify-center bg-background/50 flex-shrink-0 shadow-lg">
                        {watchLogoUrl ? (
                          <img
                            src={getLogoUrl(watchLogoUrl)}
                            alt="Logo de la empresa"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                          />
                        ) : (
                          <Building className="w-8 h-8 text-muted-foreground" />
                        )}

                        {uploadingLogo && (
                          <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                          </div>
                        )}
                      </div>

                      {/* Actions & Information */}
                      <div className="flex-1 text-center sm:text-left space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Suba un archivo de imagen en formato PNG, JPG, JPEG, WEBP o SVG. Se recomienda una imagen cuadrada.
                        </p>
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                          <label
                            htmlFor="logo-file-input"
                            className={`btn-primary flex items-center gap-2 cursor-pointer text-xs py-2 px-4 select-none ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''
                              }`}
                          >
                            <Upload className="w-4 h-4" />
                            Subir Imagen Logo
                          </label>
                          <input
                            id="logo-file-input"
                            type="file"
                            accept="image/png, image/jpeg, image/jpg, image/webp, image/svg+xml"
                            className="hidden"
                            onChange={handleLogoUpload}
                            disabled={uploadingLogo}
                          />

                          <button
                            type="button"
                            onClick={() => setShowManualUrl(!showManualUrl)}
                            className="text-xs text-muted-foreground hover:text-primary transition-colors py-2 px-3 border border-border/50 rounded-lg bg-background/20 hover:bg-background/40"
                          >
                            {showManualUrl ? 'Ocultar URL manual' : 'Configurar URL manualmente'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Manual URL input */}
                    {showManualUrl && (
                      <div className="mt-4 pt-4 border-t border-border/30 animate-fade-in">
                        <label htmlFor="company-logo-url" className="block text-xs font-medium text-muted-foreground mb-1.5">
                          Dirección URL externa del Logo
                        </label>
                        <div className="relative">
                          <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input
                            id="company-logo-url"
                            type="text"
                            {...registerCompany('logo_url')}
                            className="input-field pl-10 font-mono text-sm"
                            placeholder="https://www.miwisp.com/logo.png"
                          />
                        </div>
                        {companyErrors.logo_url && (
                          <p className="text-xs text-destructive mt-1">{companyErrors.logo_url.message}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end pt-4">
                    <button
                      type="submit"
                      id="save-company-btn"
                      disabled={companyMutation.isPending}
                      className="btn-primary"
                    >
                      {companyMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {companyMutation.isPending ? 'Guardando...' : 'Guardar Empresa'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* ── Tab Content: Gateway ────────────────────────────────────────────────── */}
          {activeTab === 'gateway' && (
            <div className="space-y-4">

              {/* ── Sección: Conectividad por Defecto ─────────────────────────── */}
              <div className="glass-card p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <SlidersHorizontal className="w-5 h-5 text-brand-400" />
                    Conectividad por Defecto
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1">
                    Credenciales y puertos que se auto-completarán al registrar nuevos routers MikroTik.
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const target = e.currentTarget as any
                    localStorage.setItem('wisp_default_puerto_api', target.puerto.value)
                    localStorage.setItem('wisp_default_usuario_api', target.usuario.value)
                    localStorage.setItem('wisp_default_password_api', target.password.value)
                    localStorage.setItem('wisp_default_monitoreo_trafico', target.monitoreo.checked ? 'true' : 'false')
                    localStorage.setItem('wisp_default_control_velocidad', target.control.checked ? 'true' : 'false')
                    setStatusMessage({ type: 'success', text: 'Valores de conectividad guardados exitosamente.' })
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Puerto API
                      </label>
                      <input
                        name="puerto"
                        type="number"
                        defaultValue={localStorage.getItem('wisp_default_puerto_api') || '8728'}
                        className="input-field font-mono"
                        placeholder="8728"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Usuario API
                      </label>
                      <input
                        name="usuario"
                        type="text"
                        defaultValue={localStorage.getItem('wisp_default_usuario_api') || 'admin'}
                        className="input-field"
                        placeholder="admin"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Contraseña API
                      </label>
                      <input
                        name="password"
                        type="password"
                        defaultValue={localStorage.getItem('wisp_default_password_api') || ''}
                        className="input-field"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  <div className="pt-1 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        name="monitoreo"
                        type="checkbox"
                        defaultChecked={(localStorage.getItem('wisp_default_monitoreo_trafico') || 'true') === 'true'}
                        className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border"
                      />
                      <span className="text-sm font-medium text-foreground">Habilitar Monitoreo de Tráfico por defecto</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        name="control"
                        type="checkbox"
                        defaultChecked={(localStorage.getItem('wisp_default_control_velocidad') || 'true') === 'true'}
                        className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border"
                      />
                      <span className="text-sm font-medium text-foreground">Habilitar Control de Velocidad por defecto</span>
                    </label>
                  </div>

                  <div className="flex justify-end pt-4 border-t border-border/50">
                    <button type="submit" className="btn-primary">
                      <Save className="w-4 h-4" />
                      Guardar Conectividad
                    </button>
                  </div>
                </form>
              </div>

              {/* ── Sección: Colas Padre ───────────────────────────────────────── */}
              <div className="glass-card p-6 space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Router className="w-5 h-5 text-brand-400" />
                    Nombres de Cola Padre
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1">
                    Gestiona los nombres de colas padre disponibles para seleccionar al registrar o editar un router.
                  </p>
                </div>

                {/* Formulario de agregar */}
                <form onSubmit={handleAddColaPadre} className="flex gap-3 max-w-md items-end">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Nueva Cola Padre
                    </label>
                    <input
                      type="text"
                      value={newColaPadre}
                      onChange={(e) => setNewColaPadre(e.target.value)}
                      className="input-field font-mono"
                      placeholder="isp_padre_global"
                    />
                  </div>
                  <button type="submit" className="btn-primary select-none h-11 px-4">
                    <Plus className="w-4 h-4" />
                    Agregar
                  </button>
                </form>

                {/* Tabla de colas padre */}
                {colasPadre.length > 0 ? (
                  <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-secondary/40 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <th className="px-4 py-3">Nombre de la Cola Padre</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-sm">
                        {colasPadre.map((c) => (
                          <tr key={c} className="hover:bg-secondary/20 transition-colors">
                            <td className="px-4 py-3">
                              {editingColaPadre === c ? (
                                <input
                                  type="text"
                                  value={editingColaPadreVal}
                                  onChange={(e) => setEditingColaPadreVal(e.target.value)}
                                  className="input-field py-1 px-2 text-sm max-w-[280px] font-mono"
                                />
                              ) : (
                                <span className="font-mono font-semibold text-foreground">{c}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                {editingColaPadre === c ? (
                                  <>
                                    <button type="button" onClick={() => handleSaveColaPadre(c)}
                                      className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all cursor-pointer" title="Guardar">
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button type="button" onClick={() => setEditingColaPadre(null)}
                                      className="p-1 text-muted-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer" title="Cancelar">
                                      <X className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" onClick={() => { setEditingColaPadre(c); setEditingColaPadreVal(c) }}
                                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer" title="Editar">
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button type="button" onClick={() => handleDeleteColaPadre(c)}
                                      className="p-1 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer" title="Eliminar">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
                    <Router className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    <p>No hay colas padre configuradas. Agrega una arriba.</p>
                  </div>
                )}
              </div>

              {/* ── Sección: Address Lists ─────────────────────────────────────── */}
              <div className="glass-card p-6 space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Hash className="w-5 h-5 text-brand-400" />
                    Nombres de Address List de Clientes
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1">
                    Gestiona los nombres de Address Lists disponibles para seleccionar al registrar o editar un router.
                  </p>
                </div>

                {/* Formulario de agregar */}
                <form onSubmit={handleAddAddressList} className="flex gap-3 max-w-md items-end">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Nueva Address List
                    </label>
                    <input
                      type="text"
                      value={newAddressList}
                      onChange={(e) => setNewAddressList(e.target.value)}
                      className="input-field font-mono"
                      placeholder="isp_clientes_norte"
                    />
                  </div>
                  <button type="submit" className="btn-primary select-none h-11 px-4">
                    <Plus className="w-4 h-4" />
                    Agregar
                  </button>
                </form>

                {/* Tabla de address lists */}
                {addressLists.length > 0 ? (
                  <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-secondary/40 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <th className="px-4 py-3">Nombre de la Address List</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-sm">
                        {addressLists.map((a) => (
                          <tr key={a} className="hover:bg-secondary/20 transition-colors">
                            <td className="px-4 py-3">
                              {editingAddressList === a ? (
                                <input
                                  type="text"
                                  value={editingAddressListVal}
                                  onChange={(e) => setEditingAddressListVal(e.target.value)}
                                  className="input-field py-1 px-2 text-sm max-w-[280px] font-mono"
                                />
                              ) : (
                                <span className="font-mono font-semibold text-foreground">{a}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                {editingAddressList === a ? (
                                  <>
                                    <button type="button" onClick={() => handleSaveAddressList(a)}
                                      className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all cursor-pointer" title="Guardar">
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button type="button" onClick={() => setEditingAddressList(null)}
                                      className="p-1 text-muted-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer" title="Cancelar">
                                      <X className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" onClick={() => { setEditingAddressList(a); setEditingAddressListVal(a) }}
                                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer" title="Editar">
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button type="button" onClick={() => handleDeleteAddressList(a)}
                                      className="p-1 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer" title="Eliminar">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
                    <Hash className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    <p>No hay Address Lists configuradas. Agrega una arriba.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ── Tab Content: Facturación ─────────────────────────────────────────── */}
          {activeTab === 'billing' && (
            <div className="space-y-6 animate-fade-in">
              {/* Horizontal Sub-tabs */}
              <div className="flex flex-wrap gap-1 p-1 bg-secondary/30 rounded-xl border border-secondary/50 max-w-max">
                {[
                  { id: 'billing', label: 'Ajustes' },
                  { id: 'suspension', label: 'Suspensión' },
                  { id: 'payment_methods', label: 'Método de Pago' },
                ].map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => { setGeneralSubTab(sub.id as any); setStatusMessage(null); }}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${generalSubTab === sub.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {generalSubTab === 'billing' && (
                <div className="glass-card p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Receipt className="w-5 h-5 text-brand-400" />
                      Configuración de Facturación
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      Administra las políticas de facturación automática, ciclos de cobro y notificaciones de pago a tus suscriptores.
                    </p>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const target = e.currentTarget as any
                      localStorage.setItem('wisp_billing_hora_generacion', target.horaGeneracion.value)
                      localStorage.setItem('wisp_billing_ciclo', target.cicloFacturacion.value)
                      localStorage.setItem('wisp_billing_modo_precio', target.modoPrecio.value)
                      localStorage.setItem('wisp_billing_auto_aprobar_enviar', target.autoAprobarEnviar.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_billing_detener_suspendidos', target.detenerSuspendidos.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_billing_notify_new_invoice', target.notifyNewInvoice.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_billing_attach_pdf_receipt', target.attachPdfReceipt.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_billing_default_dia_pago', target.defaultDiaPago.value)
                      localStorage.setItem('wisp_billing_default_dias_gracia', target.defaultDiasGracia.value)
                      localStorage.setItem('wisp_billing_aviso_nueva_factura', target.avisoNuevaFactura.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_billing_aviso_previo_dias', target.avisoPrevioDias.value)
                      localStorage.setItem('wisp_billing_recordatorios_pago', target.recordatoriosPago.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_billing_recordatorio_frecuencia_dias', target.recordatorioFrecuenciaDias.value)

                      setStatusMessage({
                        type: 'success',
                        text: 'Las políticas de facturación global se actualizaron correctamente.',
                      })
                    }}
                    className="space-y-6"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Hora de generación de facturas
                        </label>
                        <input
                          name="horaGeneracion"
                          type="time"
                          defaultValue={localStorage.getItem('wisp_billing_hora_generacion') || '08:00'}
                          className="input-field font-mono"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Ciclo de facturación por defecto
                        </label>
                        <select
                          name="cicloFacturacion"
                          defaultValue={localStorage.getItem('wisp_billing_ciclo') || 'mensual'}
                          className="input-field"
                        >
                          <option value="mensual">Mensual</option>
                          <option value="bimestral">Bimestral</option>
                          <option value="trimestral">Trimestral</option>
                          <option value="semestral">Semestral</option>
                          <option value="anual">Anual</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Modo de precio
                        </label>
                        <select
                          name="modoPrecio"
                          defaultValue={localStorage.getItem('wisp_billing_modo_precio') || 'incluido'}
                          className="input-field"
                        >
                          <option value="incluido">Precios incluyendo impuestos</option>
                          <option value="excluido">Precios excluyendo impuestos</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Día de pago mensual predeterminado
                        </label>
                        <input
                          name="defaultDiaPago"
                          type="number"
                          min="1"
                          max="28"
                          defaultValue={localStorage.getItem('wisp_billing_default_dia_pago') || '5'}
                          className="input-field font-mono"
                          placeholder="5"
                        />
                        <span className="text-[10px] text-muted-foreground block">
                          Día del mes establecido por defecto para los cobros a nuevos clientes.
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Días de gracia
                        </label>
                        <input
                          name="defaultDiasGracia"
                          type="number"
                          min="0"
                          defaultValue={localStorage.getItem('wisp_billing_default_dias_gracia') || '3'}
                          className="input-field font-mono"
                          placeholder="3"
                        />
                        <span className="text-[10px] text-muted-foreground block">
                          Días adicionales concedidos para realizar el pago antes de recargos o suspensión del servicio.
                        </span>
                      </div>
                    </div>

                    <hr className="border-border/50" />

                    <div className="space-y-4">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Políticas de Automatización
                      </h4>

                      <div className="space-y-3">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="autoAprobarEnviar"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_billing_auto_aprobar_enviar') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Aprobar y enviar facturas automáticamente
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Los borradores de facturas se aprueban y se envían automáticamente al cliente inmediatamente después de ser generados.
                            </span>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="detenerSuspendidos"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_billing_detener_suspendidos') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Detener la facturación de servicios suspendidos
                            </span>
                            <span className="text-xs text-muted-foreground">
                              No se facturarán los períodos de facturación que estén cubiertos en su totalidad por una suspensión del servicio.
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <hr className="border-border/50" />

                    <div className="space-y-4">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Notificaciones y Avisos a Clientes
                      </h4>

                      <div className="space-y-4">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="notifyNewInvoice"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_billing_notify_new_invoice') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Notificar Factura nueva
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Enviar automáticamente un correo electrónico de notificación al cliente cuando se genera una nueva factura.
                            </span>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="attachPdfReceipt"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_billing_attach_pdf_receipt') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Adjuntar el recibo como archivo PDF
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Adjuntar el archivo PDF de la factura/recibo de pago en el correo de notificación saliente.
                            </span>
                          </div>
                        </label>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7">
                          <div className="space-y-3">
                            <label className="flex items-start gap-3 cursor-pointer select-none">
                              <input
                                name="avisoNuevaFactura"
                                type="checkbox"
                                defaultChecked={(localStorage.getItem('wisp_billing_aviso_nueva_factura') || 'true') === 'true'}
                                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-semibold text-foreground block">Aviso de nueva factura</span>
                                <span className="text-[10px] text-muted-foreground">Enviar un aviso previo al cliente.</span>
                              </div>
                            </label>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-muted-foreground block uppercase">Días de aviso previo</label>
                              <input
                                name="avisoPrevioDias"
                                type="number"
                                min="1"
                                defaultValue={localStorage.getItem('wisp_billing_aviso_previo_dias') || '5'}
                                className="input-field py-1 px-2 text-xs font-mono w-24"
                              />
                            </div>
                          </div>

                          <div className="space-y-3">
                            <label className="flex items-start gap-3 cursor-pointer select-none">
                              <input
                                name="recordatoriosPago"
                                type="checkbox"
                                defaultChecked={(localStorage.getItem('wisp_billing_recordatorios_pago') || 'true') === 'true'}
                                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                              />
                              <div>
                                <span className="text-xs font-semibold text-foreground block">Recordatorios de pago</span>
                                <span className="text-[10px] text-muted-foreground">Enviar recordatorios automáticos de facturas pendientes.</span>
                              </div>
                            </label>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-muted-foreground block uppercase">Enviar recordatorio cada (días)</label>
                              <input
                                name="recordatorioFrecuenciaDias"
                                type="number"
                                min="1"
                                defaultValue={localStorage.getItem('wisp_billing_recordatorio_frecuencia_dias') || '3'}
                                className="input-field py-1 px-2 text-xs font-mono w-24"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-border/50">
                      <button type="submit" className="btn-primary">
                        <Save className="w-4 h-4" />
                        Guardar Facturación
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {generalSubTab === 'suspension' && (
                <div className="glass-card p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <Ban className="w-5 h-5 text-brand-400" />
                      Políticas de Suspensión de Servicio
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      Establece las reglas para la suspensión automática por falta de pago y notificaciones de corte del servicio de internet.
                    </p>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const target = e.currentTarget as any
                      localStorage.setItem('wisp_suspension_motivos', target.motivosSuspension.value)
                      localStorage.setItem('wisp_suspension_automatica', target.suspensionAutomatica.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_suspension_hora', target.horaSuspension.value)
                      localStorage.setItem('wisp_suspension_retraso_dias', target.retrasoDias.value)
                      localStorage.setItem('wisp_suspension_permitir_aplazamiento', target.permitirAplazamiento.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_suspension_notify_suspendido', target.notifySuspendido.checked ? 'true' : 'false')
                      localStorage.setItem('wisp_suspension_notify_pospuesto', target.notifyPospuesto.checked ? 'true' : 'false')

                      setStatusMessage({
                        type: 'success',
                        text: 'Las políticas de suspensión del servicio fueron actualizadas exitosamente.',
                      })
                    }}
                    className="space-y-6"
                  >
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Motivos de la suspensión manual (separados por comas)
                      </label>
                      <input
                        name="motivosSuspension"
                        type="text"
                        defaultValue={localStorage.getItem('wisp_suspension_motivos') || 'Falta de Pago, Solicitud del Cliente, Mantenimiento'}
                        className="input-field"
                        placeholder="Falta de Pago, Solicitud del Cliente, Mantenimiento"
                      />
                      <span className="text-xs text-muted-foreground block">
                        Razones válidas para seleccionar al suspender manualmente un servicio.
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Hora de suspensión (Formato 24h)
                        </label>
                        <input
                          name="horaSuspension"
                          type="number"
                          min="0"
                          max="23"
                          defaultValue={localStorage.getItem('wisp_suspension_hora') || '0'}
                          className="input-field font-mono"
                          placeholder="0"
                        />
                        <span className="text-xs text-muted-foreground block">
                          Hora en formato 24h en la que se ejecutará la suspensión del servicio.
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                          Retraso de suspensión (días)
                        </label>
                        <input
                          name="retrasoDias"
                          type="number"
                          min="0"
                          defaultValue={localStorage.getItem('wisp_suspension_retraso_dias') || '0'}
                          className="input-field font-mono"
                          placeholder="0"
                        />
                        <span className="text-xs text-muted-foreground block">
                          Use "0" para suspender el servicio el día inmediato después del vencimiento de la factura.
                        </span>
                      </div>
                    </div>

                    <hr className="border-border/50" />

                    <div className="space-y-4">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Automatización y Aplazamiento
                      </h4>

                      <div className="space-y-3">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="suspensionAutomatica"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_suspension_automatica') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Suspender servicios si el pago está vencido
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Cuando está habilitado, los servicios con facturas vencidas se suspenderán de forma automática. Este es el comportamiento por defecto (se puede anular por cliente).
                            </span>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="permitirAplazamiento"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_suspension_permitir_aplazamiento') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Habilitar el aplazamiento de la suspensión
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Permite a los clientes aplazar su suspensión por 24 horas. Esto les facilita realizar el pago en línea directamente en la pantalla de suspensión sin loguearse a la Zona de clientes.
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <hr className="border-border/50" />

                    <div className="space-y-4">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Notificaciones de Suspensión
                      </h4>

                      <div className="space-y-3">
                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="notifySuspendido"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_suspension_notify_suspendido') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              Servicio suspendido
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Enviar un correo electrónico automático de notificación a los clientes a quienes se les ha suspendido el servicio.
                            </span>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer select-none">
                          <input
                            name="notifyPospuesto"
                            type="checkbox"
                            defaultChecked={(localStorage.getItem('wisp_suspension_notify_pospuesto') || 'true') === 'true'}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium text-foreground block">
                              La suspensión del servicio ha sido pospuesta
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Enviar un correo electrónico de notificación cuando se ha pospuesto manualmente la suspensión del cliente desde el panel.
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-border/50">
                      <button type="submit" className="btn-primary">
                        <Save className="w-4 h-4" />
                        Guardar Políticas de Suspensión
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {generalSubTab === 'payment_methods' && (
                <div className="glass-card p-6 space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-brand-400" />
                      Gestión de Métodos de Pago
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      Agrega, edita y administra los métodos de pago aceptados para registrar los cobros manuales y facturación de tus clientes.
                    </p>
                  </div>

                  <form onSubmit={handleAddPaymentMethod} className="flex gap-3 max-w-md items-end">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                        Nuevo Método de Pago
                      </label>
                      <input
                        type="text"
                        value={newMethodLabel}
                        onChange={(e) => setNewMethodLabel(e.target.value)}
                        className="input-field"
                        placeholder="Ej: PayPal, Binance, Western Union"
                      />
                    </div>
                    <button type="submit" className="btn-primary select-none h-11 px-4">
                      <Plus className="w-4 h-4" />
                      Agregar
                    </button>
                  </form>

                  <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-secondary/40 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <th className="px-4 py-3">Nombre visible (Label)</th>
                          <th className="px-4 py-3">Código interno (Value)</th>
                          <th className="px-4 py-3">Tipo</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 text-sm">
                        {paymentMethods.map((m) => (
                          <tr key={m.value} className="hover:bg-secondary/20 transition-colors">
                            <td className="px-4 py-3">
                              {editingValue === m.value ? (
                                <input
                                  type="text"
                                  value={editingLabel}
                                  onChange={(e) => setEditingLabel(e.target.value)}
                                  className="input-field py-1 px-2 text-sm max-w-[220px] font-sans"
                                />
                              ) : (
                                <span className="font-semibold text-foreground">{m.label}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.value}</td>
                            <td className="px-4 py-3">
                              {m.isSystem ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                                  Sistema
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                                  Personalizado
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                {editingValue === m.value ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(m.value)}
                                      className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all cursor-pointer"
                                      title="Guardar"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingValue(null)}
                                      className="p-1 text-muted-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                                      title="Cancelar"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingValue(m.value)
                                        setEditingLabel(m.label)
                                      }}
                                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                                      title="Editar nombre"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    {!m.isSystem && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeletePaymentMethod(m.value)}
                                        className="p-1 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                                        title="Eliminar método de pago"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab Content: Users ────────────────────────────────────────────────────── */}
          {activeTab === 'users' && (
            <div className="glass-card p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Users className="w-5 h-5 text-brand-400" />
                    Gestión de Operadores y Usuarios
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1">
                    Registra tus técnicos, instaladores, administradores y personal de cobranzas, asignando permisos y horarios de acceso.
                  </p>
                </div>
                <button
                  onClick={handleOpenCreateUser}
                  className="btn-primary select-none text-xs py-2 px-3"
                >
                  <UserPlus className="w-4 h-4" />
                  Nuevo Operador
                </button>
              </div>

              {loadingUsers ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-secondary/40 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="px-4 py-3">Nombre</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Tipo de Operador</th>
                        <th className="px-4 py-3">Horario</th>
                        <th className="px-4 py-3">Estado</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 text-sm">
                      {usersList.map((u) => (
                        <tr key={u.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-semibold text-foreground">{u.nombre}</td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.email}</td>
                          <td className="px-4 py-3 capitalize">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                              {(u.tipo_operador || u.rol).replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                            {u.horario_acceso || 'Libre'}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleToggleUserStatus(u)}
                              className="flex items-center gap-1.5 focus:outline-none cursor-pointer"
                              title="Hacer clic para activar/desactivar"
                            >
                              {u.activo ? (
                                <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                                  <ToggleRight className="w-5 h-5 text-emerald-400" /> Activo
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-muted-foreground text-xs font-semibold">
                                  <ToggleLeft className="w-5 h-5 text-muted-foreground" /> Inactivo
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleOpenEditUser(u)}
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                                title="Editar Operador"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              {u.id !== currentUser?.id && (
                                <button
                                  onClick={() => handleDeleteUser(u.id)}
                                  className="p-1.5 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                                  title="Eliminar Operador"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Tab Content: Alertas ──────────────────────────────────────────────── */}
          {activeTab === 'alerts' && (
            <div className="glass-card p-12 text-center max-w-xl mx-auto space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto border border-amber-500/25 animate-pulse">
                <Bell className="w-8 h-8 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Centro de Alertas</h3>
              <p className="text-muted-foreground text-sm">
                Panel consolidado de notificaciones de estado de enrutadores, latencia alta, y eventos del sistema. Próximamente (Fase 3).
              </p>
            </div>
          )}

          {/* ── Modal Dialog: Crear / Editar Usuario ──────────────────────────────── */}
          {isUserModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
              <div className="glass-card w-full max-w-2xl shadow-2xl relative flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-border">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-brand-400" />
                    <span>{editingUser ? 'Editar Operador' : 'Registrar Nuevo Operador'}</span>
                  </h3>
                  <button
                    onClick={() => setIsUserModalOpen(false)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmitUser((data) => userMutation.mutate(data))} className="flex-1 overflow-y-auto p-6 space-y-5">

                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5" /> Datos Personales
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase block">Nombre Completo *</label>
                        <input type="text" {...registerUser('nombre')} className="input-field" placeholder="Geo Guncay" required />
                        {userErrors.nombre && <p className="text-xs text-destructive">{userErrors.nombre.message}</p>}
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase block">Correo Electrónico *</label>
                        <input type="email" {...registerUser('email')} className="input-field" placeholder="geo@wisp.com" required />
                        {userErrors.email && <p className="text-xs text-destructive">{userErrors.email.message}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase block">
                          Contraseña {editingUser ? '(Dejar en blanco para mantener)' : '*'}
                        </label>
                        <input type="password" {...registerUser('password')} className="input-field" placeholder="••••••••" required={!editingUser} />
                        {userErrors.password && <p className="text-xs text-destructive">{userErrors.password.message}</p>}
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase block">Tipo de Operador *</label>
                        <select {...registerUser('tipo_operador')} className="input-field">
                          <option value="administrador">Administrador</option>
                          <option value="operador_pagos">Operador de Pagos</option>
                          <option value="instalador">Instalador</option>
                          <option value="soporte_tecnico">Soporte Técnico</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <hr className="border-border/50" />

                  {/* Horario y Restricciones */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5" /> Horario de Acceso
                    </h4>
                    <div className="grid grid-cols-2 gap-4 max-w-sm">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground block">Hora Inicio</label>
                        <input type="time" {...registerUser('horario_inicio')} className="input-field font-mono text-center" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground block">Hora Fin</label>
                        <input type="time" {...registerUser('horario_fin')} className="input-field font-mono text-center" />
                      </div>
                    </div>
                  </div>

                  <hr className="border-border/50" />

                  {/* Permisos de Router */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Router className="w-3.5 h-3.5" /> Permisos Router
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Asigna los routers específicos a los que este operador tendrá acceso.</p>
                    <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-background/30 border border-border/50 max-h-[120px] overflow-y-auto">
                      {routers.map((r) => (
                        <label key={r.id} className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
                          <input
                            type="checkbox"
                            checked={selectedRouters.includes(r.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedRouters([...selectedRouters, r.id])
                              } else {
                                setSelectedRouters(selectedRouters.filter(id => id !== r.id))
                              }
                            }}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border"
                          />
                          <span>{r.nombre}</span>
                        </label>
                      ))}
                      {routers.length === 0 && (
                        <p className="text-xs text-muted-foreground col-span-2 text-center py-2">No hay routers registrados.</p>
                      )}
                    </div>
                  </div>

                  <hr className="border-border/50" />

                  {/* Permisos generales */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5" /> Permisos Operativos
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-xl bg-background/30 border border-border/50">
                      {DISPONIBLE_PERMISOS.map((p) => (
                        <label key={p.value} className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
                          <input
                            type="checkbox"
                            checked={selectedPermisos.includes(p.value)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPermisos([...selectedPermisos, p.value])
                              } else {
                                setSelectedPermisos(selectedPermisos.filter(val => val !== p.value))
                              }
                            }}
                            className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 bg-secondary/50 border-border"
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-3 border-t border-border">
                    <button
                      type="button"
                      onClick={() => setIsUserModalOpen(false)}
                      className="flex-1 bg-secondary/40 text-foreground border border-border hover:bg-secondary/70 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={userMutation.isPending}
                      className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50"
                    >
                      {userMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Guardando...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" /> Guardar
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
