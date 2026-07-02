import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, RefreshCw, Wifi, WifiOff, LogIn, UserX, UserCheck, Server, Zap,
  Download, UserPlus, ToggleLeft,
} from 'lucide-react'
import api from '@/services/api'

interface AuditLog {
  id: string
  usuario_id: string | null
  usuario_nombre: string | null
  accion: string
  entidad_tipo: string | null
  entidad_id: string | null
  entidad_nombre: string | null
  detalle: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

interface AuditLogListResponse {
  items: AuditLog[]
  total: number
}

const ACTION_META: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
  USER_LOGIN:      { label: 'Inicio de sesión',       color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',         icon: LogIn },
  CREATE_GATEWAY:  { label: 'Gateway creado',          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Server },
  UPDATE_GATEWAY:  { label: 'Gateway actualizado',     color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: Server },
  DELETE_GATEWAY:  { label: 'Gateway eliminado',       color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: Server },
  GATEWAY_ONLINE:  { label: 'Gateway en línea',        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Wifi },
  GATEWAY_OFFLINE: { label: 'Gateway fuera de línea',  color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: WifiOff },
  IMPORT_CLIENTS:  { label: 'Importación clientes',    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',   icon: Download },
  CREATE_CLIENT:   { label: 'Cliente creado',          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserPlus },
  UPDATE_CLIENT:   { label: 'Cliente actualizado',     color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: UserCheck },
  DELETE_CLIENT:   { label: 'Cliente eliminado',       color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: UserX },
  SUSPEND_CLIENT:  { label: 'Cliente suspendido',      color: 'text-orange-400 bg-orange-500/10 border-orange-500/20',   icon: UserX },
  ACTIVATE_CLIENT: { label: 'Cliente activado',        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserCheck },
  ASSIGN_PLAN:     { label: 'Plan asignado',           color: 'text-brand-400 bg-brand-500/10 border-brand-500/20',      icon: Zap },
  TOGGLE_QUEUE:    { label: 'Cola toggled',            color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: ToggleLeft },
  CREATE_PAYMENT:  { label: 'Pago registrado',         color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Zap },
}

const ACCION_OPTIONS = Object.entries(ACTION_META).map(([value, { label }]) => ({ value, label }))

function ActionBadge({ accion }: { accion: string }) {
  const meta = ACTION_META[accion] ?? { label: accion, color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: ClipboardList }
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${meta.color}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}

function LogDetailCell({ detalle }: { detalle: Record<string, unknown> | null }) {
  if (!detalle) return <span className="text-muted-foreground">—</span>
  const parts: string[] = []
  if ('motivo' in detalle) parts.push(`Motivo: ${detalle.motivo}`)
  if ('plan_nombre' in detalle) parts.push(`Plan: ${detalle.plan_nombre}`)
  if ('imported_count' in detalle) parts.push(`${detalle.imported_count} importados`)
  if ('list_name' in detalle) parts.push(`Lista: ${detalle.list_name}`)
  if ('disabled' in detalle) parts.push(detalle.disabled ? 'Deshabilitada' : 'Habilitada')
  if ('ip' in detalle) parts.push(`IP: ${detalle.ip}`)
  return <span className="text-xs text-muted-foreground">{parts.join(' · ') || '—'}</span>
}

const LOG_LIMIT = 50

export function LogsSettingsTab() {
  const [logPage, setLogPage] = useState(1)
  const [logFilterAccion, setLogFilterAccion] = useState('')
  const [logFilterEntidad, setLogFilterEntidad] = useState('')

  const { data: logsData, isLoading: logsLoading, isFetching: logsFetching, refetch: refetchLogs } = useQuery<AuditLogListResponse>({
    queryKey: ['audit-logs', logPage, logFilterAccion, logFilterEntidad],
    queryFn: async () => {
      const params: Record<string, string | number> = { skip: (logPage - 1) * LOG_LIMIT, limit: LOG_LIMIT }
      if (logFilterAccion) params.accion = logFilterAccion
      if (logFilterEntidad) params.entidad_tipo = logFilterEntidad
      const { data } = await api.get('/audit-logs', { params })
      return data
    },
    refetchInterval: 30_000,
  })
  const logTotalPages = Math.ceil((logsData?.total ?? 0) / LOG_LIMIT)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Filtros */}
      <div className="glass-card p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-brand-400 uppercase tracking-wider">
          <ClipboardList className="w-3.5 h-3.5" />
          Filtros
        </div>
        <select
          value={logFilterAccion}
          onChange={(e) => { setLogFilterAccion(e.target.value); setLogPage(1) }}
          className="input-field w-52"
        >
          <option value="">Todas las acciones</option>
          {ACCION_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={logFilterEntidad}
          onChange={(e) => { setLogFilterEntidad(e.target.value); setLogPage(1) }}
          className="input-field w-40"
        >
          <option value="">Todas las entidades</option>
          <option value="Gateway">Gateway</option>
          <option value="Client">Cliente</option>
          <option value="User">Usuario</option>
        </select>
        {(logFilterAccion || logFilterEntidad) && (
          <button
            onClick={() => { setLogFilterAccion(''); setLogFilterEntidad(''); setLogPage(1) }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Limpiar filtros
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {logsData && (
            <span className="text-xs text-muted-foreground">{logsData.total} eventos totales</span>
          )}
          <button
            onClick={() => refetchLogs()}
            disabled={logsFetching}
            className="btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${logsFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Tabla */}
      {logsLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando registros...</span>
        </div>
      ) : !logsData?.items.length ? (
        <div className="glass-card p-12 text-center">
          <ClipboardList className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin eventos registrados</h3>
          <p className="text-sm text-muted-foreground">
            Los eventos del sistema aparecerán aquí conforme se realicen acciones.
          </p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha / Hora</th>
                <th>Evento</th>
                <th>Entidad</th>
                <th>Detalle</th>
                <th>Usuario</th>
                <th className="hidden md:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {logsData.items.map((log) => (
                <tr key={log.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="whitespace-nowrap">
                    <span className="text-xs font-mono text-muted-foreground">
                      {new Date(log.created_at).toLocaleString('es-EC', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                  </td>
                  <td><ActionBadge accion={log.accion} /></td>
                  <td>
                    {log.entidad_nombre ? (
                      <div>
                        <span className="text-xs font-medium text-foreground">{log.entidad_nombre}</span>
                        {log.entidad_tipo && (
                          <span className="block text-[10px] text-muted-foreground">{log.entidad_tipo}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td><LogDetailCell detalle={log.detalle} /></td>
                  <td>
                    <span className="text-xs text-foreground font-medium">
                      {log.usuario_nombre ?? <span className="text-muted-foreground italic">Sistema</span>}
                    </span>
                  </td>
                  <td className="hidden md:table-cell">
                    <code className="text-[10px] text-muted-foreground font-mono">
                      {log.ip_address ?? '—'}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {logTotalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Página {logPage} de {logTotalPages} · {logsData?.total} registros
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLogPage((p) => Math.max(p - 1, 1))}
              disabled={logPage === 1}
              className="btn-secondary py-1.5 px-3 text-xs"
            >
              Anterior
            </button>
            <button
              onClick={() => setLogPage((p) => Math.min(p + 1, logTotalPages))}
              disabled={logPage === logTotalPages}
              className="btn-secondary py-1.5 px-3 text-xs"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
