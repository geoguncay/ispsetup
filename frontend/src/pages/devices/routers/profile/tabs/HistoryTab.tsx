import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Server, Wifi, WifiOff, Download, UserPlus, UserX, UserCheck, Zap, ToggleLeft,
  ClipboardList, RefreshCw, Loader2,
} from 'lucide-react'
import api from '@/services/api'
import { useTimeFormat } from '@/hooks/useDateFormat'

const AUDIT_META: Record<string, { label: string; color: string; icon: React.ComponentType<any> }> = {
    CREATE_GATEWAY:  { label: 'Router creado',       color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Server },
    UPDATE_GATEWAY:  { label: 'Configuración editada', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: Server },
    DELETE_GATEWAY:  { label: 'Router eliminado',    color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: Server },
    GATEWAY_ONLINE:  { label: 'Conectado',            color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Wifi },
    GATEWAY_OFFLINE: { label: 'Desconectado',         color: 'text-red-400 bg-red-500/10 border-red-500/20',            icon: WifiOff },
    IMPORT_CLIENTS:  { label: 'Importación clientes', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',   icon: Download },
    CREATE_CLIENT:   { label: 'Cliente creado',       color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserPlus },
    SUSPEND_CLIENT:  { label: 'Cliente suspendido',   color: 'text-orange-400 bg-orange-500/10 border-orange-500/20',   icon: UserX },
    ACTIVATE_CLIENT: { label: 'Cliente activado',     color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: UserCheck },
    ASSIGN_PLAN:     { label: 'Plan asignado',        color: 'text-brand-400 bg-brand-500/10 border-brand-500/20',      icon: Zap },
    TOGGLE_QUEUE:    { label: 'Cola modificada',      color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',      icon: ToggleLeft },
}

interface HistoryTabProps {
  routerId: string | undefined
  pollingPaused: boolean
}

/** Historial ISP: eventos de auditoría de este router. */
export function HistoryTab({ routerId: id, pollingPaused }: HistoryTabProps) {
  const hour12 = useTimeFormat() === '12H'

  const { data: auditData, isFetching: fetchingAudit, refetch: refetchAudit } = useQuery<{
    items: Array<{
      id: string; action: string; user_name: string | null
      entity_name: string | null; detail: Record<string, unknown> | null
      ip_address: string | null; created_at: string
    }>
    total: number
  }>({
    queryKey: ['router-audit', id],
    queryFn: async () => {
      const { data } = await api.get('/audit-logs', {
        params: { entity_id: id, limit: 100 }
      })
      return data
    },
    refetchInterval: pollingPaused ? false : 15_000,
  })

  return (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-foreground">Historial de eventos</span>
                  {auditData && (
                    <span className="text-xs text-muted-foreground">
                      — {auditData.total} eventos
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => refetchAudit()}
                  disabled={fetchingAudit}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  {fetchingAudit
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5" />}
                  Actualizar
                </button>
              </div>

              {fetchingAudit && !auditData ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Cargando historial...</span>
                </div>
              ) : auditData && auditData.items.length > 0 ? (
                <div className="glass-card overflow-hidden overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Fecha / Hora</th>
                        <th>Evento</th>
                        <th>Detalle</th>
                        <th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditData.items.map((entry) => {
                        const meta = AUDIT_META[entry.action] ?? {
                          label: entry.action,
                          color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
                          icon: ClipboardList,
                        }
                        const Icon = meta.icon
                        const detail = entry.detail
                        const detailText = detail
                          ? Object.entries(detail)
                              .filter(([k]) => k !== 'source')
                              .map(([k, v]) => {
                                if (k === 'reason') return `Motivo: ${v}`
                                if (k === 'plan_name') return `Plan: ${v}`
                                if (k === 'imported_count') return `${v} importados`
                                if (k === 'disabled') return v ? 'Deshabilitada' : 'Habilitada'
                                if (k === 'ip') return `IP: ${v}`
                                return null
                              })
                              .filter(Boolean)
                              .join(' · ')
                          : ''
                        return (
                          <tr key={entry.id} className="hover:bg-secondary/30 transition-colors">
                            <td className="whitespace-nowrap">
                              <span className="text-xs font-mono text-muted-foreground">
                                {new Date(entry.created_at).toLocaleString('es-EC', {
                                  day: '2-digit', month: '2-digit', year: '2-digit',
                                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                                  hour12,
                                })}
                              </span>
                            </td>
                            <td>
                              <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${meta.color}`}>
                                <Icon className="w-3 h-3" />
                                {meta.label}
                              </span>
                            </td>
                            <td>
                              <span className="text-xs text-muted-foreground">
                                {detailText || '—'}
                              </span>
                            </td>
                            <td>
                              <span className="text-xs text-foreground font-medium">
                                {entry.user_name ?? (
                                  <span className="text-muted-foreground italic">Sistema</span>
                                )}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border/40 rounded-xl">
                  <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No hay eventos registrados para este router.</p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Se actualiza automáticamente cada 15 segundos
              </p>
            </div>
  )
}
