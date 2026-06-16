/**
 * RouterFormDialog — Modal para crear y editar routers con test de conexión.
 */
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, CheckCircle2, XCircle, Plug, Eye, EyeOff } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import api from '@/services/api'

const routerSchema = z.object({
  id: z.string().optional(),
  nombre: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  ip: z.string().min(7, 'IP inválida').max(45),
  puerto_api: z.coerce.number().min(1).max(65535),
  usuario_api: z.string().min(1, 'Requerido').max(120),
  password_api: z.string().optional(),
  modelo_hw: z.string().max(120).optional(),
  notas: z.string().optional(),
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
)

type RouterFormData = z.infer<typeof routerSchema>

interface RouterFormDialogProps {
  open: boolean
  onClose: () => void
  router?: { id: string; nombre: string; ip: string; puerto_api: number; usuario_api: string; modelo_hw: string | null; notas: string | null } | null
  onSuccess: () => void
}

interface TestResult {
  success: boolean
  message: string
  ros_version?: string
  uptime?: string
  error?: string
}

export function RouterFormDialog({ open, onClose, router, onSuccess }: RouterFormDialogProps) {
  const isEdit = !!router
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<RouterFormData>({
    resolver: zodResolver(routerSchema) as any,
    defaultValues: {
      puerto_api: 8728,
    },
  })

  useEffect(() => {
    if (open) {
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
        })
      } else {
        reset({ id: undefined, puerto_api: 8728, nombre: '', ip: '', usuario_api: '', password_api: '' })
      }
    }
  }, [open, router, reset])

  const saveMutation = useMutation({
    mutationFn: async (data: RouterFormData) => {
      const { id, ...payload } = data
      if (isEdit && !payload.password_api) {
        delete payload.password_api
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
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || 'Error al contactar el servidor'
      setTestResult({ success: false, message: errMsg, error: 'Error de red/servidor' })
    } finally {
      setIsTesting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {isEdit ? `Editar: ${router!.nombre}` : 'Agregar router'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Credenciales cifradas con Fernet AES-128
            </p>
          </div>
          <button
            id="close-router-dialog"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form
          id="router-form"
          onSubmit={handleSubmit((data) => saveMutation.mutate(data))}
          className="p-5 space-y-4"
        >
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

          {/* IP y puerto */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                IP / Host de conexión *
              </label>
              <input
                id="router-ip"
                type="text"
                placeholder="192.168.88.1 o 10.147.17.x"
                {...register('ip')}
                className="input-field font-mono"
              />
              {errors.ip && (
                <p className="text-xs text-destructive mt-1">{errors.ip.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Puerto</label>
              <input
                id="router-port"
                type="number"
                {...register('puerto_api')}
                className="input-field font-mono"
              />
            </div>
          </div>

          {/* Usuario y contraseña */}
          <div className="grid grid-cols-2 gap-3">
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

          {/* Modelo HW (opcional) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Modelo hardware <span className="text-muted-foreground text-xs">(opcional)</span>
            </label>
            <input
              id="router-model"
              type="text"
              placeholder="RB4011iGS+, hAP ax³, etc."
              {...register('modelo_hw')}
              className="input-field"
            />
          </div>

          {/* Notas (opcional) */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Notas <span className="text-muted-foreground text-xs">(opcional)</span>
            </label>
            <textarea
              id="router-notas"
              rows={2}
              placeholder="Ubicación, observaciones..."
              {...register('notas')}
              className="input-field resize-none"
            />
          </div>

          {/* Test de conexión */}
          <div className="border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Probar conexión</p>
              <button
                type="button"
                id="test-connection-btn"
                onClick={handleTest}
                disabled={isTesting}
                className="btn-secondary text-xs py-1.5"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plug className="w-3.5 h-3.5" />
                )}
                {isTesting ? 'Probando...' : 'Probar ahora'}
              </button>
            </div>

            {testResult && (
              <div
                className={`rounded-lg p-3 flex items-start gap-3 ${
                  testResult.success
                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                    : 'bg-destructive/10 border border-destructive/30'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                )}
                <div className="text-xs space-y-1">
                  <p className={testResult.success ? 'text-emerald-400' : 'text-destructive'}>
                    {testResult.message}
                  </p>
                  {testResult.ros_version && (
                    <p className="text-muted-foreground">
                      RouterOS {testResult.ros_version} · Uptime: {testResult.uptime}
                    </p>
                  )}
                  {testResult.error && (
                    <p className="text-muted-foreground font-mono">{testResult.error}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error de guardado */}
          {saveMutation.isError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3">
              <p className="text-sm text-destructive">
                Error al guardar. Verifica los datos e intenta de nuevo.
              </p>
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              id="cancel-router-form"
              onClick={onClose}
              className="btn-secondary flex-1 justify-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              id="save-router-btn"
              disabled={saveMutation.isPending}
              className="btn-primary flex-1 justify-center"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {saveMutation.isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar router'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
