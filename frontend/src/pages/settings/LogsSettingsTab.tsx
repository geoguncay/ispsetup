import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, RefreshCw, Wifi, WifiOff, LogIn, UserX, UserCheck, Server, Zap,
  Download, UserPlus, ToggleLeft,
} from 'lucide-react'
import api from '@/services/api'

interface AuditLog {
  id: string
  user_id: string | null
  user_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  entity_name: string | null
  detail: Record<string, unknown> | null
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

const ACTION_OPTIONS = Object.entries(ACTION_META).map(([value, { label }]) => ({ value, label }))

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action] ?? { label: action, color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: ClipboardList }
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${meta.color}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}

function LogDetailCell({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span className="text-muted-foreground">—</span>
  const parts: string[] = []
  if ('reason' in detail) parts.push(`Motivo: ${detail.reason}`)
  if ('plan_name' in detail) parts.push(`Plan: ${detail.plan_name}`)
  if ('imported_count' in detail) parts.push(`${detail.imported_count} importados`)
  if ('list_name' in detail) parts.push(`Lista: ${detail.list_name}`)
  if ('disabled' in detail) parts.push(detail.disabled ? 'Deshabilitada' : 'Habilitada')
  if ('ip' in detail) parts.push(`IP: ${detail.ip}`)
  return <span className="text-xs text-muted-foreground">{parts.join(' · ') || '—'}</span>
}

const LOG_LIMIT = 50

export function LogsSettingsTab() {
  const [logPage, setLogPage] = useState(1)
  const [logFilterAction, setLogFilterAction] = useState('')
  const [logFilterEntityType, setLogFilterEntityType] = useState('')

  const { data: logsData, isLoading: logsLoading, isFetching: logsFetching, refetch: refetchLogs } = useQuery<AuditLogListResponse>({
    queryKey: ['audit-logs', logPage, logFilterAction, logFilterEntityType],
    queryFn: async () => {
      const params: Record<string, string | number> = { skip: (logPage - 1) * LOG_LIMIT, limit: LOG_LIMIT }
      if (logFilterAction) params.action = logFilterAction
      if (logFilterEntityType) params.entity_type = logFilterEntityType
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
          value={logFilterAction}
          onChange={(e) => { setLogFilterAction(e.target.value); setLogPage(1) }}
          className="input-field w-52"
        >
          <option value="">Todas las acciones</option>
          {ACTION_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={logFilterEntityType}
          onChange={(e) => { setLogFilterEntityType(e.target.value); setLogPage(1) }}
          className="input-field w-40"
        >
          <option value="">Todas las entidades</option>
          <option value="Gateway">Gateway</option>
          <option value="Client">Cliente</option>
          <option value="User">Usuario</option>
        </select>
        {(logFilterAction || logFilterEntityType) && (
          <button
            onClick={() => { setLogFilterAction(''); setLogFilterEntityType(''); setLogPage(1) }}
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
                  <td><ActionBadge action={log.action} /></td>
                  <td>
                    {log.entity_name ? (
                      <div>
                        <span className="text-xs font-medium text-foreground">{log.entity_name}</span>
                        {log.entity_type && (
                          <span className="block text-[10px] text-muted-foreground">{log.entity_type}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td><LogDetailCell detail={log.detail} /></td>
                  <td>
                    <span className="text-xs text-foreground font-medium">
                      {log.user_name ?? <span className="text-muted-foreground italic">Sistema</span>}
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
