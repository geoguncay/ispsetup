import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Users, UserPlus, Loader2, ToggleLeft, ToggleRight, Edit2, Trash2, X, Shield, Clock, Router,
  Save,
} from 'lucide-react'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

interface UserItem {
  id: string
  name: string
  email: string
  role: 'admin' | 'technician' | 'viewer'
  active: boolean
  inactivity_timeout: number
  operator_type?: string
  gateway_permissions?: string
  access_schedule?: string
  permissions?: string
  created_at: string
}

const userSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  email: z.string().email('Email inválido'),
  password: z.string().optional().or(z.literal('')),
  role: z.enum(['admin', 'technician', 'viewer']),
  operator_type: z.string(),
  active: z.boolean().default(true),
  inactivity_timeout: z.coerce.number().default(0),
  start_time: z.string().default('00:00'),
  end_time: z.string().default('23:59'),
})

type UserFormData = z.infer<typeof userSchema>

const AVAILABLE_PERMISSIONS = [
  { value: 'clients:view', label: 'Ver Clientes' },
  { value: 'clients:create', label: 'Registrar/Editar Clientes' },
  { value: 'payments:register', label: 'Registrar Pagos/Cobros' },
  { value: 'invoices:manage', label: 'Administrar Facturas' },
  { value: 'inventory:manage', label: 'Administrar Stock/Inventario' },
  { value: 'gateways:manage', label: 'Administrar Routers' },
]

export function UsersSettingsTab({ setStatusMessage }: { setStatusMessage: StatusSetter }) {
  const { user: currentUser } = useAuthStore()

  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [selectedGateways, setSelectedGateways] = useState<string[]>([])
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])

  const { data: usersList = [], refetch: refetchUsers, isLoading: loadingUsers } = useQuery<UserItem[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return data
    },
  })

  const { data: gateways = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['gateways-list-settings'],
    queryFn: async () => {
      const { data } = await api.get('/gateways')
      return data
    },
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
      role: 'viewer',
      operator_type: 'technical_support',
      active: true,
      inactivity_timeout: 0,
      start_time: '00:00',
      end_time: '23:59',
    }
  })

  const watchOperatorType = watchUser('operator_type')

  // Auto-map operator type to standard role and default permissions
  useEffect(() => {
    if (watchOperatorType === 'administrator') {
      setValueUser('role', 'admin')
      setSelectedPermissions(AVAILABLE_PERMISSIONS.map(p => p.value))
    } else if (watchOperatorType === 'payments_operator') {
      setValueUser('role', 'viewer')
      setSelectedPermissions(['payments:register', 'clients:view'])
    } else if (watchOperatorType === 'installer') {
      setValueUser('role', 'technician')
      setSelectedPermissions(['clients:view', 'clients:create'])
    } else if (watchOperatorType === 'technical_support') {
      setValueUser('role', 'technician')
      setSelectedPermissions(['clients:view', 'clients:create', 'gateways:manage'])
    }
  }, [watchOperatorType, setValueUser])

  const userMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      const payload: any = {
        name: data.name,
        email: data.email,
        role: data.role,
        active: data.active,
        inactivity_timeout: data.inactivity_timeout,
        operator_type: data.operator_type,
        gateway_permissions: selectedGateways.join(','),
        access_schedule: `${data.start_time}-${data.end_time}`,
        permissions: selectedPermissions.join(','),
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
      name: '',
      email: '',
      password: '',
      role: 'viewer',
      operator_type: 'technical_support',
      active: true,
      inactivity_timeout: 0,
      start_time: '08:00',
      end_time: '18:00',
    })
    setSelectedGateways([])
    setSelectedPermissions(['clients:view', 'clients:create', 'gateways:manage'])
    setIsUserModalOpen(true)
  }

  const handleOpenEditUser = (u: UserItem) => {
    setEditingUser(u)
    let start = '00:00'
    let end = '23:59'
    if (u.access_schedule && u.access_schedule.includes('-')) {
      const split = u.access_schedule.split('-')
      start = split[0]
      end = split[1]
    }
    resetUser({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      operator_type: u.operator_type || 'technical_support',
      active: u.active,
      inactivity_timeout: u.inactivity_timeout,
      start_time: start,
      end_time: end,
    })
    setSelectedGateways(u.gateway_permissions ? u.gateway_permissions.split(',') : [])
    setSelectedPermissions(u.permissions ? u.permissions.split(',') : [])
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
      await api.put(`/users/${u.id}`, { active: !u.active })
      setStatusMessage({ type: 'success', text: `Estado del usuario actualizado.` })
      refetchUsers()
    } catch (e: any) {
      setStatusMessage({ type: 'error', text: 'Fallo al actualizar estado.' })
    }
  }

  return (
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
                  <td className="px-4 py-3 font-semibold text-foreground">{u.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3 capitalize">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                      {(u.operator_type || u.role).replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {u.access_schedule || 'Libre'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleUserStatus(u)}
                      className="flex items-center gap-1.5 focus:outline-none cursor-pointer"
                      title="Hacer clic para activar/desactivar"
                    >
                      {u.active ? (
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
                    <input type="text" {...registerUser('name')} className="input-field" placeholder="Geo Guncay" required />
                    {userErrors.name && <p className="text-xs text-destructive">{userErrors.name.message}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase block">Correo Electrónico *</label>
                    <input type="email" {...registerUser('email')} className="input-field" placeholder="geo@isp.com" required />
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
                    <select {...registerUser('operator_type')} className="input-field">
                      <option value="administrator">Administrador</option>
                      <option value="payments_operator">Operador de Pagos</option>
                      <option value="installer">Instalador</option>
                      <option value="technical_support">Soporte Técnico</option>
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
                    <input type="time" {...registerUser('start_time')} className="input-field font-mono text-center" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-muted-foreground block">Hora Fin</label>
                    <input type="time" {...registerUser('end_time')} className="input-field font-mono text-center" />
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
                  {gateways.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground py-0.5">
                      <div className="relative inline-flex items-center flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={selectedGateways.includes(g.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGateways([...selectedGateways, g.id])
                            } else {
                              setSelectedGateways(selectedGateways.filter(id => id !== g.id))
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-[13px] after:w-[13px] after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </div>
                      <span>{g.name}</span>
                    </label>
                  ))}
                  {gateways.length === 0 && (
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
                  {AVAILABLE_PERMISSIONS.map((p) => (
                    <label key={p.value} className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground py-0.5">
                      <div className="relative inline-flex items-center flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(p.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPermissions([...selectedPermissions, p.value])
                            } else {
                              setSelectedPermissions(selectedPermissions.filter(val => val !== p.value))
                            }
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-[13px] after:w-[13px] after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                      </div>
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
  )
}
