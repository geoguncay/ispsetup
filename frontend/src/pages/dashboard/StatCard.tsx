import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatTone = 'brand' | 'emerald' | 'red' | 'amber' | 'violet' | 'sky' | 'orange' | 'slate'

const TONES: Record<StatTone, { color: string; bg: string; border: string }> = {
  brand:   { color: 'text-brand-400',   bg: 'bg-brand-900/30',   border: 'border-brand-800/40' },
  emerald: { color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-800/30' },
  red:     { color: 'text-red-400',     bg: 'bg-red-900/20',     border: 'border-red-800/30' },
  amber:   { color: 'text-amber-400',   bg: 'bg-amber-900/20',   border: 'border-amber-800/30' },
  violet:  { color: 'text-violet-400',  bg: 'bg-violet-900/20',  border: 'border-violet-800/30' },
  sky:     { color: 'text-sky-400',     bg: 'bg-sky-900/20',     border: 'border-sky-800/30' },
  orange:  { color: 'text-orange-400',  bg: 'bg-orange-900/20',  border: 'border-orange-800/30' },
  slate:   { color: 'text-slate-400',   bg: 'bg-slate-900/20',   border: 'border-slate-800/30' },
}

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  tone: StatTone
  /** Texto secundario bajo el valor (p. ej. variación o detalle). */
  hint?: string
  /** Ruta destino; si se indica toda la tarjeta es un enlace. */
  to?: string
  loading?: boolean
}

export function StatCard({ label, value, icon: Icon, tone, hint, to, loading }: StatCardProps) {
  const t = TONES[tone]
  const content = (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center border', t.bg, t.border)}>
          <Icon className={cn('w-4 h-4', t.color)} />
        </div>
      </div>
      <p className={cn('font-bold', t.color, String(value).length > 8 ? 'text-2xl' : 'text-3xl')}>
        {loading ? '—' : value}
      </p>
      {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  )
  const className = cn('block rounded-xl border p-4 backdrop-blur-sm', t.bg, t.border)

  return to ? (
    <Link to={to} className={cn(className, 'transition-colors hover:brightness-125')}>{content}</Link>
  ) : (
    <div className={className}>{content}</div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{children}</p>
  )
}
