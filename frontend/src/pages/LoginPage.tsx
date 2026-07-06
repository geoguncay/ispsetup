/**
 * LoginPage — Página de inicio de sesión premium con diseño dark.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Wifi, Eye, EyeOff, Loader2, Shield, Activity } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { getLogoUrl } from '@/components/AppLayout'
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

interface CompanyPublic {
  name: string
  logo_url: string | null
  use_logo_on_login: boolean
  login_bg_url: string | null
  use_login_bg: boolean
}

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
})
type LoginForm = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const { login, isLoading } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [company, setCompany] = useState<CompanyPublic | null>(null)

  useEffect(() => {
    axios.get<CompanyPublic>(`${BASE_URL}/company/public`).then(({ data }) => {
      setCompany(data)
    }).catch(() => {
      // falla silenciosa — se usa diseño por defecto
    })
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (data: LoginForm) => {
    setError(null)
    try {
      await login(data.email, data.password)
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      setError(axiosErr?.response?.data?.detail ?? 'Error al iniciar sesión')
    }
  }

  const showLogo = company?.use_logo_on_login && company?.logo_url
  const showBg = company?.use_login_bg && company?.login_bg_url
  const companyName = company?.name && company.name !== 'Mi ISP' && company.name !== 'Mi WISP'
    ? company.name
    : 'ISP Platform'

  return (
    <div className="min-h-screen flex bg-surface-200">
      {/* ── Panel izquierdo — branding (60%) ── */}
      <div
        className="hidden lg:flex flex-col justify-between flex-1 p-12 relative overflow-hidden border-r border-border"
        style={showBg
          ? {
            backgroundImage: `url(${getLogoUrl(company!.login_bg_url)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
          : undefined
        }
      >
        {/* Overlay degradado cuando hay imagen de fondo */}
        {showBg && (
          <div className="absolute inset-0 bg-gradient-to-br from-surface-50/80 via-surface-200/60 to-surface-200/80 pointer-events-none" />
        )}

        {/* Degradado por defecto cuando no hay imagen */}
        {!showBg && (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-900/80 via-surface-50 to-surface-200 pointer-events-none" />
        )}

        {/* Glow decorativo */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-brand-600/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl translate-x-1/4 translate-y-1/4 pointer-events-none" />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/30 overflow-hidden">
            {showLogo ? (
              <img
                src={getLogoUrl(company!.logo_url)}
                className="w-full h-full object-cover"
                alt="Logo"
              />
            ) : (
              <Wifi className="w-5 h-5 text-white" strokeWidth={2.5} />
            )}
          </div>
          <div>
            <p className="font-bold text-foreground">{companyName}</p>
            <p className="text-xs text-muted-foreground">NMS</p>
          </div>
        </div>

        {/*  */}
        <div className="relative z-10 space-y-6">
          <div>
            <h1 className="text-4xl font-bold text-foreground leading-tight">
              Gestión centralizada<br />
              <span className="text-brand-400">para tu red ISP</span>
            </h1>
            <p className="mt-4 text-muted-foreground text-sm">
              Administra tu red, clientes y servicios desde un solo lugar.
            </p>  
          </div>
        </div>

        <p className="text-xs text-muted-foreground relative z-10">
          © 2026 {companyName} — Ecuador
        </p>
      </div>

      {/* ── Panel derecho — formulario (40%) ── */}
      <div className="w-full lg:w-[40%] flex-shrink-0 flex items-center justify-center p-8">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center overflow-hidden">
              {showLogo ? (
                <img src={getLogoUrl(company!.logo_url)} className="w-full h-full object-cover" alt="Logo" />
              ) : (
                <Wifi className="w-4 h-4 text-white" />
              )}
            </div>
            <p className="font-bold text-foreground">{companyName}</p>
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-1">Iniciar sesión</h2>
          <p className="text-muted-foreground text-sm mb-8">
            Ingresa tus credenciales para acceder al panel
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" id="login-form">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="admin@isp.local"
                {...register('email')}
                className="input-field"
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className="input-field pr-11"
                />
                <button
                  type="button"
                  id="toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {/* Error general */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              id="login-submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center py-3"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isLoading ? 'Autenticando...' : 'Iniciar sesión'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
