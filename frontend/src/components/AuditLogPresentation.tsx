import {
  Boxes, Building2, ClipboardList, Download, FileText, LogIn, LogOut,
  MapPin, Package, Receipt, Server, Settings, ShieldAlert, TicketCheck,
  UserCheck, UserPlus, UserX, Users, Wifi, WifiOff, Zap,
} from 'lucide-react'
import { ACTION_LABELS } from '@/components/auditLogMeta'

const FIELD_LABELS: Record<string, string> = {
  summary: 'Resumen', changes: 'Cambios', before: 'Anterior', after: 'Nuevo',
  reason: 'Motivo', source: 'Origen', plan_name: 'Plan', plan: 'Plan',
  imported_count: 'Importados', failed_count: 'Fallidos', total: 'Total',
  fields_changed: 'Campos modificados', disabled: 'Deshabilitada', ip: 'IP',
  api_port: 'Puerto API', router: 'Router', client: 'Cliente', amount: 'Monto',
  method: 'Método', period: 'Periodo', due_date: 'Vencimiento', filename: 'Archivo',
  size_bytes: 'Tamaño', success: 'Resultado', synchronized_count: 'Sincronizados',
  processed: 'Procesados', failed: 'Fallidos', pending_before: 'Pendientes iniciales',
  sync_pending_count: 'Sincronizaciones pendientes', legacy_record: 'Registro histórico',
  cleanup_summary: 'Resumen de limpieza', routeros_configuration: 'Configuración RouterOS',
  historical_data: 'Datos históricos', deleted_clients: 'Clientes eliminados',
}

function humanizeKey(key: string): string {
  return FIELD_LABELS[key] ?? key
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Sin valor'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number') return new Intl.NumberFormat('es-EC').format(value)
  return String(value)
}

function DetailValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <span>Ninguno</span>
    return (
      <div className="mt-1 space-y-1 border-l border-border pl-2">
        {value.map((item, index) => (
          <div key={index}><DetailValue value={item} /></div>
        ))}
      </div>
    )
  }
  if (value && typeof value === 'object') {
    return (
      <div className="mt-1 space-y-1 border-l border-border pl-2">
        {Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
          if (
            nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)
            && ('before' in nestedValue || 'after' in nestedValue)
          ) {
            const change = nestedValue as { before?: unknown; after?: unknown }
            return (
              <div key={key}>
                <span className="font-medium text-foreground">{humanizeKey(key)}:</span>{' '}
                <span>{formatPrimitive(change.before)} → {formatPrimitive(change.after)}</span>
              </div>
            )
          }
          return (
            <div key={key}>
              <span className="font-medium text-foreground">{humanizeKey(key)}:</span>{' '}
              <DetailValue value={nestedValue} />
            </div>
          )
        })}
      </div>
    )
  }
  return <span>{formatPrimitive(value)}</span>
}

export function AuditDetail({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail) return <span className="text-xs text-muted-foreground">Sin detalle registrado</span>
  const summary = formatPrimitive(detail.summary)
  const entries = Object.entries(detail).filter(([key]) => key !== 'summary')

  return (
    <div className="min-w-[180px] max-w-xl text-xs text-muted-foreground">
      <span>{summary}</span>
      {entries.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[11px] text-brand-400 hover:text-brand-300">
            Ver detalle completo ({entries.length})
          </summary>
          <div className="mt-1.5 space-y-1 rounded-md bg-secondary/40 p-2">
            {entries.map(([key, value]) => (
              <div key={key}>
                <span className="font-medium text-foreground">{humanizeKey(key)}:</span>{' '}
                <DetailValue value={value} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ActionIcon({ action }: { action: string }) {
  const className = 'h-3 w-3'
  if (action === 'USER_LOGIN') return <LogIn className={className} />
  if (action === 'USER_LOGOUT') return <LogOut className={className} />
  if (action === 'USER_LOGIN_FAILED') return <ShieldAlert className={className} />
  if (action === 'GATEWAY_ONLINE') return <Wifi className={className} />
  if (action === 'GATEWAY_OFFLINE') return <WifiOff className={className} />
  if (action.includes('GATEWAY') || action.includes('PPPOE')) return <Server className={className} />
  if (action.includes('CLIENT') && action.startsWith('CREATE')) return <UserPlus className={className} />
  if (action.includes('CLIENT') && (action.startsWith('DELETE') || action.startsWith('SUSPEND'))) return <UserX className={className} />
  if (action.includes('CLIENT')) return <UserCheck className={className} />
  if (action.includes('USER')) return <Users className={className} />
  if (action.includes('INVOICE')) return <FileText className={className} />
  if (action.includes('PAYMENT')) return <Receipt className={className} />
  if (action.includes('INVENTORY') || action.includes('CATEGORY')) return <Package className={className} />
  if (action.includes('COMPANY')) return <Building2 className={className} />
  if (action.includes('SITE')) return <MapPin className={className} />
  if (action.includes('TICKET')) return <TicketCheck className={className} />
  if (action.includes('SETTINGS') || action === 'SYSTEM_BACKUP') return <Settings className={className} />
  if (action.includes('IMPORT')) return <Download className={className} />
  if (action.includes('PLAN') || action.includes('QUEUE')) return <Zap className={className} />
  if (action.includes('SUPPLIER') || action.includes('SERVICE')) return <Boxes className={className} />
  return <ClipboardList className={className} />
}

function actionColor(action: string): string {
  if (action.includes('FAILED') || action.startsWith('DELETE') || action.includes('OFFLINE')) {
    return 'text-red-400 bg-red-500/10 border-red-500/20'
  }
  if (action.startsWith('CREATE') || action.startsWith('ACTIVATE') || action.includes('ONLINE')) {
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
  }
  if (action.startsWith('UPDATE') || action.startsWith('TOGGLE') || action.startsWith('SUSPEND')) {
    return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
  }
  if (action.includes('IMPORT') || action.includes('BACKUP')) {
    return 'text-purple-400 bg-purple-500/10 border-purple-500/20'
  }
  return 'text-blue-400 bg-blue-500/10 border-blue-500/20'
}

export function AuditActionBadge({ action }: { action: string }) {
  const fallback = action.replace(/_/g, ' ').toLocaleLowerCase('es')
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${actionColor(action)}`}>
      <ActionIcon action={action} />
      {ACTION_LABELS[action] ?? fallback}
    </span>
  )
}
