import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import type { ScriptRun } from './types'

interface ScriptRunDetailDialogProps {
  run: ScriptRun | null
  onClose: () => void
}

export function ScriptRunDetailDialog({ run: selectedRun, onClose }: ScriptRunDetailDialogProps) {
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  if (!selectedRun) return null

  return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-2xl mx-4 animate-fade-in max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
              <h3 className="text-lg font-semibold text-foreground">Detalle de ejecución</h3>
              <button onClick={() => onClose()} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDateTime(selectedRun.created_at, dateFormat, timeFormat)}</span>
                <span>·</span>
                <span>{selectedRun.origin === 'template' ? `Plantilla (${selectedRun.algorithm ?? '—'})` : 'Script libre'}</span>
                <span>·</span>
                <span>{selectedRun.executed_by_name ?? '—'}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground mb-1.5">Script ejecutado</p>
                <pre className="text-xs font-mono bg-black/30 p-3 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{selectedRun.source}</pre>
              </div>
              {selectedRun.output && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-1.5">Salida</p>
                  <pre className={`text-xs font-mono p-3 rounded border overflow-x-auto whitespace-pre-wrap ${selectedRun.success ? 'bg-black/30 border-border/50 text-muted-foreground' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                    {selectedRun.output}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>,
    document.body
  )
}
