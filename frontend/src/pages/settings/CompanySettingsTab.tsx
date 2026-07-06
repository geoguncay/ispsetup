import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Building, Globe, Phone, MapPin, Hash, Mail, Upload, Loader2 } from 'lucide-react'
import api from '@/services/api'
import { getLogoUrl } from '@/components/AppLayout'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

const companySchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  ruc: z.string().max(20).optional().or(z.literal('')),
  address: z.string().max(255).optional().or(z.literal('')),
  phone: z.string().max(40).optional().or(z.literal('')),
  email: z.string().email('Correo inválido').optional().or(z.literal('')).or(z.null()),
  website: z.string().max(255).optional().or(z.literal('')),
  logo_url: z.string().max(255).optional().or(z.literal('')).or(z.null()),
  use_logo_on_login: z.boolean().default(false),
  login_bg_url: z.string().max(255).optional().or(z.literal('')).or(z.null()),
  use_login_bg: z.boolean().default(false),
})

type CompanyFormData = z.infer<typeof companySchema>

export function CompanySettingsTab({ setStatusMessage }: { setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  const {
    data: companyData,
    isLoading: loadingCompany,
  } = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const { data } = await api.get('/company')
      return data
    },
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
  const watchLoginBgUrl = watchCompany('login_bg_url')
  const [isCompanyDirty, setIsCompanyDirty] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingLoginBg, setUploadingLoginBg] = useState(false)
  const [showManualUrl, setShowManualUrl] = useState(false)

  useEffect(() => {
    if (companyData) {
      resetCompany({
        name: companyData.name,
        ruc: companyData.ruc || '',
        address: companyData.address || '',
        phone: companyData.phone || '',
        email: companyData.email || '',
        website: companyData.website || '',
        logo_url: companyData.logo_url || '',
        use_logo_on_login: companyData.use_logo_on_login ?? false,
        login_bg_url: companyData.login_bg_url || '',
        use_login_bg: companyData.use_login_bg ?? false,
      })
      if (companyData.logo_url && (companyData.logo_url.startsWith('http://') || companyData.logo_url.startsWith('https://'))) {
        setShowManualUrl(true)
      }
      setIsCompanyDirty(false)
    }
  }, [companyData, resetCompany])

  const companyMutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      const cleanData = { ...data }
      if (cleanData.email === '') cleanData.email = null
      if (cleanData.logo_url === '') cleanData.logo_url = null
      if (cleanData.login_bg_url === '') cleanData.login_bg_url = null
      await api.put('/company', cleanData)
    },
    onSuccess: () => {
      setIsCompanyDirty(false)
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
      setIsCompanyDirty(true)
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

  const handleLoginBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!validTypes.includes(file.type)) {
      setStatusMessage({ type: 'error', text: 'Solo se permiten imágenes (PNG, JPG, JPEG, WEBP)' })
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    setUploadingLoginBg(true)
    setStatusMessage(null)

    try {
      const { data } = await api.post('/company/login-bg', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setValueCompany('login_bg_url', data.login_bg_url)
      setIsCompanyDirty(true)
      queryClient.invalidateQueries({ queryKey: ['company'] })
      setStatusMessage({ type: 'success', text: 'Fondo de inicio de sesión subido correctamente' })
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.response?.data?.detail || 'Error al subir el fondo' })
    } finally {
      setUploadingLoginBg(false)
      e.target.value = ''
    }
  }

  return (
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
          onChange={() => setIsCompanyDirty(true)}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Razón Social */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Razón Social (Nombre) *</label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="company-name"
                  type="text"
                  {...registerCompany('name')}
                  className="input-field pl-10"
                  placeholder="Mi ISP S.A."
                />
              </div>
              {companyErrors.name && (
                <p className="text-xs text-destructive mt-1">{companyErrors.name.message}</p>
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
                  id="company-phone"
                  type="text"
                  {...registerCompany('phone')}
                  className="input-field pl-10"
                  placeholder="+593 2-123-4567 o +593 99 999 9999"
                />
              </div>
              {companyErrors.phone && (
                <p className="text-xs text-destructive mt-1">{companyErrors.phone.message}</p>
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
                  placeholder="facturacion@miisp.com"
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
                  id="company-address"
                  type="text"
                  {...registerCompany('address')}
                  className="input-field pl-10"
                  placeholder="Av. Principal N34-12 y Calle Secundaria, Quito, Ecuador"
                />
              </div>
              {companyErrors.address && (
                <p className="text-xs text-destructive mt-1">{companyErrors.address.message}</p>
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
                  id="company-website"
                  type="text"
                  {...registerCompany('website')}
                  className="input-field pl-10 font-mono"
                  placeholder="https://www.miisp.com"
                />
              </div>
              {companyErrors.website && (
                <p className="text-xs text-destructive mt-1">{companyErrors.website.message}</p>
              )}
            </div>
          </div>

          {/* Logo Section */}
          <div className="col-span-1 md:col-span-2 p-4 rounded-xl bg-background/30 border border-border/50 backdrop-blur-md space-y-4">
            <label className="block text-sm font-medium text-foreground">
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
                    className={`btn-primary flex items-center gap-2 cursor-pointer text-xs py-2 px-4 select-none ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}
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
              <div className="pt-3 border-t border-border/30 animate-fade-in">
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
                    placeholder="https://www.miisp.com/logo.png"
                  />
                </div>
                {companyErrors.logo_url && (
                  <p className="text-xs text-destructive mt-1">{companyErrors.logo_url.message}</p>
                )}
              </div>
            )}

            {/* Toggle: usar logo en login */}
            <label className="flex items-center gap-4 py-3 px-4 rounded-xl bg-secondary/20 border border-border/50 cursor-pointer select-none">
              <div className="relative flex-shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={watchCompany('use_logo_on_login') ?? false}
                  onChange={e => setValueCompany('use_logo_on_login', e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full bg-muted transition-colors peer-checked:bg-brand-500" />
                <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Usar logotipo en inicio de sesión</p>
                <p className="text-xs text-muted-foreground mt-0.5">Muestra el logo de la empresa en la pantalla de login</p>
              </div>
            </label>
          </div>

          {/* Login Background Section */}
          <div className="col-span-1 md:col-span-2 p-4 rounded-xl bg-background/30 border border-border/50 backdrop-blur-md space-y-4">
            <label className="block text-sm font-medium text-foreground">
              Fondo de inicio de sesión
            </label>

            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Preview */}
              <div className="relative w-32 h-20 rounded-lg overflow-hidden border-2 border-border/50 flex items-center justify-center bg-background/50 flex-shrink-0 shadow">
                {watchLoginBgUrl ? (
                  <img
                    src={getLogoUrl(watchLoginBgUrl)}
                    alt="Fondo login"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-brand-900/80 via-surface-50 to-surface-200 flex items-center justify-center">
                    <p className="text-xs text-muted-foreground text-center px-2">Fondo<br />predeterminado</p>
                  </div>
                )}
                {uploadingLoginBg && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center backdrop-blur-sm">
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex-1 text-center sm:text-left space-y-2">
                <p className="text-xs text-muted-foreground">
                  Suba una imagen para el fondo del panel de bienvenida (PNG, JPG, JPEG, WEBP). Se recomienda una imagen de alta resolución.
                </p>
                <label
                  htmlFor="login-bg-file-input"
                  className={`btn-primary inline-flex items-center gap-2 cursor-pointer text-xs py-2 px-4 select-none ${uploadingLoginBg ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <Upload className="w-4 h-4" />
                  Subir Imagen de Fondo
                </label>
                <input
                  id="login-bg-file-input"
                  type="file"
                  accept="image/png, image/jpeg, image/jpg, image/webp"
                  className="hidden"
                  onChange={handleLoginBgUpload}
                  disabled={uploadingLoginBg}
                />
                {watchLoginBgUrl && (
                  <button
                    type="button"
                    onClick={() => { setValueCompany('login_bg_url', ''); setIsCompanyDirty(true) }}
                    className="ml-2 text-xs text-destructive hover:text-destructive/80 transition-colors py-2 px-3 border border-destructive/30 rounded-lg bg-background/20 hover:bg-background/40"
                  >
                    Quitar fondo
                  </button>
                )}
              </div>
            </div>
            <label className="flex items-center gap-4 py-3 px-4 rounded-xl bg-secondary/20 border border-border/50 cursor-pointer select-none">
              <div className="relative flex-shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={watchCompany('use_login_bg') ?? false}
                  onChange={e => setValueCompany('use_login_bg', e.target.checked)}
                />
                <div className="w-11 h-6 rounded-full bg-muted transition-colors peer-checked:bg-brand-500" />
                <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Usar fondo en inicio de sesión</p>
                <p className="text-xs text-muted-foreground mt-0.5">Imagen personalizada para el panel izquierdo del login</p>
              </div>
            </label>
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              id="save-company-btn"
              disabled={companyMutation.isPending}
              className={isCompanyDirty || companyMutation.isPending ? 'btn-primary' : 'btn-secondary'}
            >
              {companyMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {companyMutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
