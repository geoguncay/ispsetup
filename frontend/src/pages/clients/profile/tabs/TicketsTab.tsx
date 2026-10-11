import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Plus } from 'lucide-react'
import api from '@/services/api'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'
import { TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from '../labels'

interface TicketsTabProps {
  clientId: string | undefined
  onCreateTicket: () => void
}

export function TicketsTab({ clientId: id, onCreateTicket }: TicketsTabProps) {
  const dateFormat = useDateFormat()

  // Consultar Tickets de Soporte
  const { data: tickets = [], isLoading: isLoadingTickets } = useQuery({
    queryKey: ['client-tickets', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/tickets`)
      return data
    }
  })

  return (
                <div className="space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Tickets del Cliente</h3>
                    <button
                      onClick={onCreateTicket}
                      className="btn-primary text-xs py-1.5 px-3 h-auto"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Nuevo Ticket
                    </button>
                  </div>

                  {isLoadingTickets ? (
                    <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Cargando tickets...
                    </div>
                  ) : tickets.length === 0 ? (
                    <p className="text-center py-6 text-sm text-muted-foreground">No hay tickets de soporte registrados.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {tickets.map((t: any) => (
                        <div key={t.id} className="glass-card p-4 hover:border-brand-500/20 transition-all duration-200 border border-border/40 relative">
                          <div className="absolute top-4 right-4 flex items-center gap-2">
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${t.priority === 'high'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : t.priority === 'medium'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                              {TICKET_PRIORITY_LABELS[t.priority] ?? t.priority}
                            </span>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${t.status === 'resolved'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : t.status === 'open'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                              }`}>
                              {TICKET_STATUS_LABELS[t.status] ?? t.status}
                            </span>
                          </div>

                          <div className="pr-24 space-y-1">
                            <h4 className="text-sm font-semibold text-foreground">{t.title}</h4>
                            <p className="text-xs text-muted-foreground font-mono">
                              Creado: {formatDate(t.created_at, dateFormat)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-3 leading-relaxed">{t.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
  )
}
