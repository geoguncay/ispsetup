import { Terminal } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import type { LoadBalancer } from '../types'

export function ScriptTab({ lb }: { lb: LoadBalancer }) {
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  return (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <Terminal className="w-4.5 h-4.5" />
              <span>Último script aplicado</span>
            </div>
            {lb.last_script_source ? (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`uppercase font-bold px-2 py-0.5 rounded-full ${lb.last_script_status === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-destructive/10 text-destructive border border-destructive/20'
                    }`}>
                    {lb.last_script_status === 'success' ? 'Exitoso' : 'Con errores'}
                  </span>
                  {lb.last_script_applied_at && <span>{formatDateTime(lb.last_script_applied_at, dateFormat, timeFormat)}</span>}
                </div>
                <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap max-h-64">{lb.last_script_source}</pre>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Todavía no se ha aplicado ningún script en este balanceador.</p>
            )}
          </div>
        </div>
  )
}
