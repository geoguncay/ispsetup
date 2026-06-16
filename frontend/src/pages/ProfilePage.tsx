/**
 * ProfilePage — Configuración de perfil de usuario y datos de la empresa.
 */
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { User, Building, Lock, Save, Loader2, CheckCircle2, XCircle, Globe, Phone, MapPin, Hash, Mail } from 'lucide-react'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

// ── Zod Schemas ──────────────────────────────────────────────────────────────
const profileSchema = z
  .object({
    nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
    email: z.string().email('Correo electrónico inválido'),
    password: z.string().optional().or(z.literal('')),
    confirmPassword: z.string().optional().or(z.literal('')),
  })
  .refine((data) => !data.password || data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

const companySchema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  ruc: z.string().max(20).optional().or(z.literal('')),
  direccion: z.string().max(255).optional().or(z.literal('')),
  telefono: z.string().max(40).optional().or(z.literal('')),
  email: z.string().email('Correo inválido').optional().or(z.literal('')).or(z.null()),
  sitio_web: z.string().max(255).optional().or(z.literal('')),
})

type ProfileFormData = z.infer<typeof profileSchema>
type CompanyFormData = z.infer<typeof companySchema>

export function ProfilePage() {
  const { user, fetchMe } = useAuthStore()
  const isAdmin = user?.rol === 'admin'
  const [activeTab, setActiveTab] = useState<'profile' | 'company'>('profile')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Formulario de Perfil ────────────────────────────────────────────────────
  const {
    register: registerProfile,
    handleSubmit: handleSubmitProfile,
    reset: resetProfile,
    formState: { errors: profileErrors },
  } = useForm<ProfileFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(profileSchema) as any,
  })

  useEffect(() => {
    if (user) {
      resetProfile({
        nombre: user.nombre,
        email: user.email,
        password: '',
        confirmPassword: '',
      })
    }
  }, [user, resetProfile])

  const profileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const payload: { nombre: string; email: string; password?: string } = {
        nombre: data.nombre,
        email: data.email,
      }
      if (data.password && data.password.trim() !== '') {
        payload.password = data.password
      }
      await api.put(`/users/${user?.id}`, payload)
    },
    onSuccess: async (_, variables) => {
      setStatusMessage({ type: 'success', text: 'Perfil actualizado exitosamente' })
      await fetchMe() // Recargar datos globales del usuario (actualiza sidebar)
      resetProfile({
        nombre: variables.nombre,
        email: variables.email,
        password: '',
        confirmPassword: '',
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      const errMsg = err?.response?.data?.detail || 'Error al actualizar el perfil'
      setStatusMessage({ type: 'error', text: errMsg })
    },
  })

  // ── Formulario de Empresa ───────────────────────────────────────────────────
  const {
    data: companyData,
    isLoading: loadingCompany,
    refetch: refetchCompany,
  } = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const { data } = await api.get('/company')
      return data
    },
    enabled: isAdmin, // Solo consultar si es admin
  })

  const {
    register: registerCompany,
    handleSubmit: handleSubmitCompany,
    reset: resetCompany,
    formState: { errors: companyErrors },
  } = useForm<CompanyFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(companySchema) as any,
  })

  useEffect(() => {
    if (companyData) {
      resetCompany({
        nombre: companyData.nombre,
        ruc: companyData.ruc || '',
        direccion: companyData.direccion || '',
        telefono: companyData.telefono || '',
        email: companyData.email || '',
        sitio_web: companyData.sitio_web || '',
      })
    }
  }, [companyData, resetCompany])

  const companyMutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      const cleanData = { ...data }
      if (cleanData.email === '') cleanData.email = null
      await api.put('/company', cleanData)
    },
    onSuccess: () => {
      setStatusMessage({ type: 'success', text: 'Datos de la empresa actualizados exitosamente' })
      refetchCompany()
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      const errMsg = err?.response?.data?.detail || 'Error al actualizar los datos de la empresa'
      setStatusMessage({ type: 'error', text: errMsg })
    },
  })



  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Gestiona tus datos personales de acceso y la información corporativa de tu WISP
        </p>
      </div>

      {/* Tabs Selector */}
      <div className="flex border-b border-border gap-2">
        <button
          onClick={() => { setActiveTab('profile'); setStatusMessage(null); }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'profile'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <User className="w-4 h-4" />
          Mi Perfil
        </button>
        {isAdmin && (
          <button
            onClick={() => { setActiveTab('company'); setStatusMessage(null); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
              activeTab === 'company'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building className="w-4 h-4" />
            Datos de la Empresa
          </button>
        )}
      </div>

      {/* Status Alert */}
      {statusMessage && (
        <div
          className={`rounded-xl p-4 flex items-start gap-3 border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-destructive/10 border-destructive/30 text-destructive'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="text-sm font-medium">{statusMessage.text}</span>
        </div>
      )}

      {/* Profile Form */}
      {activeTab === 'profile' && (
        <div className="glass-card p-6">
          <h2 className="text-base font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-brand-400" />
            Información del Perfil Personal
          </h2>
          <form
            id="profile-form"
            onSubmit={handleSubmitProfile((data) => profileMutation.mutate(data))}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Nombre Completo *</label>
                <div className="relative">
                  <input
                    id="profile-nombre"
                    type="text"
                    {...registerProfile('nombre')}
                    className="input-field"
                    placeholder="Geo"
                  />
                </div>
                {profileErrors.nombre && (
                  <p className="text-xs text-destructive mt-1">{profileErrors.nombre.message}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Correo Electrónico *</label>
                <div className="relative">
                  <input
                    id="profile-email"
                    type="email"
                    {...registerProfile('email')}
                    className="input-field"
                    placeholder="correo@ejemplo.com"
                  />
                </div>
                {profileErrors.email && (
                  <p className="text-xs text-destructive mt-1">{profileErrors.email.message}</p>
                )}
              </div>
            </div>

            <hr className="border-border/50 my-6" />

            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-brand-400" />
              Cambiar Contraseña
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Deje los campos de contraseña en blanco si no desea modificar su contraseña actual.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nueva Contraseña */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5 font-sans">Nueva Contraseña</label>
                <input
                  id="profile-password"
                  type="password"
                  {...registerProfile('password')}
                  className="input-field font-sans"
                  placeholder="Mínimo 8 caracteres"
                />
                {profileErrors.password && (
                  <p className="text-xs text-destructive mt-1">{profileErrors.password.message}</p>
                )}
              </div>

              {/* Confirmar Nueva Contraseña */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Confirmar Nueva Contraseña</label>
                <input
                  id="profile-confirm-password"
                  type="password"
                  {...registerProfile('confirmPassword')}
                  className="input-field"
                  placeholder="Repita la nueva contraseña"
                />
                {profileErrors.confirmPassword && (
                  <p className="text-xs text-destructive mt-1">{profileErrors.confirmPassword.message}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                id="save-profile-btn"
                disabled={profileMutation.isPending}
                className="btn-primary"
              >
                {profileMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {profileMutation.isPending ? 'Guardando...' : 'Guardar Perfil'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Company Form */}
      {activeTab === 'company' && isAdmin && (
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
    </div>
  )
}
