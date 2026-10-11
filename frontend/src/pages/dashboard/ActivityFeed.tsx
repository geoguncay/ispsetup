import { cn } from '@/lib/utils'
import { timeAgo } from './format'
import type { ActivityItem } from './types'

const DOT: Record<ActivityItem['kind'], string> = {
  audit: 'bg-brand-500',
  suspension: 'bg-orange-500',
  reactivation: 'bg-emerald-500',
}

interface Props {
  items: ActivityItem[] | undefined
  loading: boolean
  error: boolean
}

export function ActivityFeed({ items, loading, error }: Props) {
  return (
    <div className="glass-card p-5">
      <h2 className="text-sm font-semibold text-foreground mb-4">Actividad reciente</h2>

      {error ? (
        <p className="text-sm text-red-400 py-6 text-center">No se pudo cargar la actividad.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Cargando…</p>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Sin actividad registrada todavía</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.kind}-${item.id}`} className="flex items-start gap-3">
              <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', DOT[item.kind])} />
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {item.title}
                  {item.entity_name && <span className="text-muted-foreground"> · {item.entity_name}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.user_name ? `${item.user_name} · ` : ''}
                  {timeAgo(item.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
