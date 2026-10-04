/** RadioToolbar — Herramientas de edición del mapa de radio (AP y enlaces). */
import { Eye, Pencil, Radio, ArrowLeftRight } from 'lucide-react'

export type RadioMode = 'view' | 'edit' | 'add-ap' | 'ptp'

interface Props {
  mode: RadioMode
  onModeChange: (mode: RadioMode) => void
  hint: string
}

const TOOLS: { mode: RadioMode; label: string; icon: typeof Eye }[] = [
  { mode: 'view', label: 'Ver', icon: Eye },
  { mode: 'edit', label: 'Editar', icon: Pencil },
  { mode: 'add-ap', label: 'PtMP', icon: Radio },
  { mode: 'ptp', label: 'PtP', icon: ArrowLeftRight },
]

export function RadioToolbar({ mode, onModeChange, hint }: Props) {
  return (
    <div className="glass-card p-3 flex flex-wrap items-center gap-3">
      <div className="flex bg-secondary/50 rounded-lg p-0.5 border border-border/60">
        {TOOLS.map(({ mode: m, label, icon: Icon }) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${mode === m
              ? 'bg-brand-500 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
