/**
 * ProfilePage — Configuración de perfil de usuario personal.
 */
import React, { useRef, useState, useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import {
  User, Lock, Save, Loader2, CheckCircle2, XCircle,
  Camera, Shield, Wrench, Eye, Timer,
} from 'lucide-react'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { getLogoUrl } from '@/components/AppLayout'

// ── Role avatar config ────────────────────────────────────────────────────────
const roleConfig = {
  admin:      { bg: 'bg-brand-700',   Icon: Shield, label: 'Administrador' },
  technician: { bg: 'bg-emerald-600', Icon: Wrench, label: 'Técnico'       },
  viewer:     { bg: 'bg-slate-600',   Icon: Eye,    label: 'Visor'         },
} as const

// ── Zod Schemas ──────────────────────────────────────────────────────────────
const profileSchema = z
  .object({
    name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
    email: z.string().email('Correo electrónico inválido'),
    password: z.string().optional().or(z.literal('')),
    confirmPassword: z.string().optional().or(z.literal('')),
    inactivity_timeout: z.preprocess(
      (val) => (val === '' || val === undefined || val === null ? 0 : Number(val)),
      z.number().int().min(0, 'Debe ser mayor o igual a 0')
    ),
  })
  .refine((data) => !data.password || data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })

type ProfileFormData = z.infer<typeof profileSchema>

export function ProfilePage() {
  const { user, fetchMe } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTimeoutRef = useRef(30)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Formulario de Perfil ────────────────────────────────────────────────────
  const {
    register: registerProfile,
    handleSubmit: handleSubmitProfile,
    reset: resetProfile,
    setValue: setProfileValue,
    getValues: getProfileValues,
    control,
    formState: { errors: profileErrors },
  } = useForm<ProfileFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(profileSchema) as any,
    defaultValues: { inactivity_timeout: 0 },
  })

  // Deriva el estado del toggle directamente del valor del formulario — sin useState separado
  const watchedTimeout = useWatch({ control, name: 'inactivity_timeout', defaultValue: 0 })
  const inactivityEnabled = watchedTimeout > 0

  useEffect(() => {
    if (user) {
      const timeout = user.inactivity_timeout ?? 0
      if (timeout > 0) lastTimeoutRef.current = timeout
      resetProfile({
        name: user.name,
        email: user.email,
        password: '',
        confirmPassword: '',
        inactivity_timeout: timeout,
      })
    }
  }, [user, resetProfile])

  const handleInactivityToggle = () => {
    if (inactivityEnabled) {
      const current = getProfileValues('inactivity_timeout')
      if (current > 0) lastTimeoutRef.current = current
      setProfileValue('inactivity_timeout', 0, { shouldValidate: true })
    } else {
      setProfileValue('inactivity_timeout', lastTimeoutRef.current, { shouldValidate: true })
    }
  }

  const profileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const payload: { name: string; email: string; password?: string; inactivity_timeout: number } = {
        name: data.name,
        email: data.email,
        inactivity_timeout: data.inactivity_timeout,
      }
      if (data.password && data.password.trim() !== '') {
        payload.password = data.password
      }
      await api.put(`/users/${user?.id}`, payload)
    },
    onSuccess: async (_, variables) => {
      setStatusMessage({ type: 'success', text: 'Perfil actualizado exitosamente' })
      await fetchMe()
      resetProfile({
        name: variables.name,
        email: variables.email,
        password: '',
        confirmPassword: '',
        inactivity_timeout: variables.inactivity_timeout,
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      const errMsg = err?.response?.data?.detail || 'Error al actualizar el perfil'
      setStatusMessage({ type: 'error', text: errMsg })
    },
  })

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    const formData = new FormData()
    formData.append('file', file)

    setAvatarUploading(true)
    setStatusMessage(null)
    try {
      await api.post(`/users/${user.id}/avatar`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await fetchMe()
      setStatusMessage({ type: 'success', text: 'Foto de perfil actualizada' })
    } catch (err) {
      const errMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error al subir la imagen'
      setStatusMessage({ type: 'error', text: errMsg })
    } finally {
      setAvatarUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const role = (user?.role ?? 'viewer') as keyof typeof roleConfig
  const { bg, Icon } = roleConfig[role]

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mi Perfil</h1>
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

      {/* Avatar Section */}
      <div className="glass-card p-6">
        <h2 className="text-base font-semibold text-foreground mb-5 flex items-center gap-2">
          <User className="w-4 h-4 text-brand-400" />
          Foto de Perfil
        </h2>

        <div className="flex items-center gap-6">
          {/* Avatar display */}
          <div className="relative flex-shrink-0">
            <div className="w-24 h-24 rounded-2xl overflow-hidden ring-2 ring-border">
              {user?.avatar_url ? (
                <img
                  src={getLogoUrl(user.avatar_url)}
                  className="w-full h-full object-cover"
                  alt="Foto de perfil"
                />
              ) : (
                <div className={`w-full h-full ${bg} flex flex-col items-center justify-center gap-1`}>
                  <Icon className="w-8 h-8 text-white/80" strokeWidth={1.5} />
                  <span className="text-lg font-bold text-white uppercase leading-none">
                    {user?.name?.[0] ?? '?'}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute -bottom-2 -right-2 w-8 h-8 bg-brand-600 hover:bg-brand-500 text-white rounded-full flex items-center justify-center shadow-lg transition-colors disabled:opacity-60"
              title="Cambiar foto"
            >
              {avatarUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5" />
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="hidden"
              aria-label="Seleccionar foto de perfil"
              onChange={handleAvatarChange}
            />
          </div>

          {/* Info */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{user?.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{roleConfig[role].label}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Formatos admitidos: PNG, JPG, WEBP. Máx. 5 MB.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="btn-secondary text-xs mt-1 disabled:opacity-60"
            >
              {avatarUploading ? 'Subiendo...' : 'Cambiar foto'}
            </button>
          </div>
        </div>
      </div>

      {/* Profile Form */}
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
              <input
                id="profile-name"
                type="text"
                {...registerProfile('name')}
                className="input-field"
                placeholder="Geo"
              />
              {profileErrors.name && (
                <p className="text-xs text-destructive mt-1">{profileErrors.name.message}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Correo Electrónico *</label>
              <input
                id="profile-email"
                type="email"
                {...registerProfile('email')}
                className="input-field"
                placeholder="correo@ejemplo.com"
              />
              {profileErrors.email && (
                <p className="text-xs text-destructive mt-1">{profileErrors.email.message}</p>
              )}
            </div>

            {/* Desconexión por inactividad */}
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 py-1">
                {/* Toggle switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={inactivityEnabled}
                  onClick={handleInactivityToggle}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    inactivityEnabled ? 'bg-brand-600' : 'bg-border'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                      inactivityEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Desconexión automática por inactividad</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Cierra la sesión si no hay actividad durante el tiempo indicado
                    </p>
                  </div>
                </div>

              </div>

              {inactivityEnabled && (
                <div className="mt-3 flex items-center gap-3">
                  <input
                    id="profile-inactivity-timeout"
                    type="number"
                    min="1"
                    {...registerProfile('inactivity_timeout')}
                    className="input-field w-28"
                    placeholder="30"
                  />
                  <span className="text-sm text-muted-foreground">minutos sin actividad</span>
                  {profileErrors.inactivity_timeout && (
                    <p className="text-xs text-destructive">{profileErrors.inactivity_timeout.message}</p>
                  )}
                </div>
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
    </div>
  )
}
