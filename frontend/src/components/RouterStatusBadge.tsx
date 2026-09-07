/**
 * RouterStatusBadge — Badge animado con estado del router.
 */
import { cn } from '@/lib/utils'

type RouterStatusType = 'online' | 'offline' | 'tunnel_down' | 'degraded' | 'unknown'

interface RouterStatusBadgeProps {
  status: RouterStatusType
  showLabel?: boolean
  size?: 'sm' | 'md'
}

const statusConfig: Record<RouterStatusType, { label: string; textColor: string }> = {
  online:      { label: 'En línea',      textColor: 'text-emerald-400' },
  offline:     { label: 'Fuera de línea', textColor: 'text-red-400' },
  tunnel_down: { label: 'Túnel caído',   textColor: 'text-amber-400' },
  degraded:    { label: 'Degradado',     textColor: 'text-amber-400' },
  unknown:     { label: 'Desconocido',   textColor: 'text-slate-400' },
}

export function RouterStatusBadge({
  status,
  showLabel = true,
  size = 'md',
}: RouterStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.unknown

  return (
    <span className={cn('flex items-center gap-2', size === 'sm' ? 'text-xs' : 'text-sm')}>
      <span className={`status-dot ${status}`} />
      {showLabel && (
        <span className={cn('font-medium', config.textColor)}>{config.label}</span>
      )}
    </span>
  )
}
