import { useQuery } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import api from '@/services/api'
import { formatDateTime } from '@/lib/utils'
import { useDateFormat, useTimeFormat } from '@/hooks/useDateFormat'
import type { ScriptRun } from '../types'

interface HistoryTabProps {
  loadBalancerId: string | undefined
  pollingPaused: boolean
  onSelectRun: (run: ScriptRun) => void
}

/** Historial de ejecuciones de scripts del balanceador. */
export function HistoryTab({ loadBalancerId: id, pollingPaused, onSelectRun }: HistoryTabProps) {
  const dateFormat = useDateFormat()
  const timeFormat = useTimeFormat()

  const { data: scriptRuns = [] } = useQuery<ScriptRun[]>({
    queryKey: ['load-balancer-script-runs', id],
    queryFn: async () => {
      const { data } = await api.get(`/load-balancers/${id}/script-runs`)
      return data
    },
    refetchInterval: pollingPaused ? false : 15_000,
  })

  return (
        <div className="glass-card overflow-x-auto">
          {scriptRuns.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <ClipboardList className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
              No se ha ejecutado ningún script todavía.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Origen</th>
                  <th>Resultado</th>
                  <th>Ejecutado por</th>
                </tr>
              </thead>
              <tbody>
                {scriptRuns.map((run) => (
                  <tr key={run.id} onClick={() => onSelectRun(run)} className="cursor-pointer hover:bg-secondary/40 transition-colors">
                    <td className="text-xs font-mono text-muted-foreground">{formatDateTime(run.created_at, dateFormat, timeFormat)}</td>
                    <td>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20">
                        {run.origin === 'template' ? `Plantilla (${run.algorithm ?? '—'})` : 'Script libre'}
                      </span>
                    </td>
                    <td>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${run.success
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-destructive/10 text-destructive border border-destructive/20'
                        }`}>
                        {run.success ? 'Éxito' : 'Error'}
                      </span>
                    </td>
                    <td className="text-xs text-foreground">{run.executed_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
  )
}
