import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, X, Loader2 } from 'lucide-react'
import api from '@/services/api'
import type { AddToast } from './types'

interface CreateTicketDialogProps {
  clientId: string | undefined
  addToast: AddToast
  onClose: () => void
}

/** Registrar un ticket de soporte. Se monta solo mientras está abierto. */
export function CreateTicketDialog({ clientId: id, addToast, onClose }: CreateTicketDialogProps) {
  const queryClient = useQueryClient()
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketDesc, setTicketDesc] = useState('')
  const [ticketPriority, setTicketPriority] = useState('medium')

  const createTicketMutation = useMutation({
    mutationFn: async (payload: { title: string; description: string; priority: string }) => {
      await api.post(`/clients/${id}/tickets`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-tickets', id] })
      onClose()
      addToast('Ticket registrado correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al registrar ticket'
      addToast(msg, 'error')
    }
  })

  return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-sm mx-4 animate-fade-in">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-brand-400" />
                Registrar Ticket de Soporte
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!ticketTitle || !ticketDesc) return
                createTicketMutation.mutate({
                  title: ticketTitle,
                  description: ticketDesc,
                  priority: ticketPriority
                })
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Título del Problema *</label>
                <input
                  type="text"
                  value={ticketTitle}
                  onChange={(e) => setTicketTitle(e.target.value)}
                  placeholder="Ej: Intermitencia de señal, lentitud..."
                  required
                  className="input-field"
                />
              </div>

              <div className="grid grid-cols-1 gap-2">
                <label className="block text-sm font-medium text-foreground mb-0.5">Prioridad *</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value)}
                  className="input-field cursor-pointer"
                >
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Descripción Detallada *</label>
                <textarea
                  value={ticketDesc}
                  onChange={(e) => setTicketDesc(e.target.value)}
                  placeholder="Describe los detalles de la falla reportada..."
                  required
                  rows={4}
                  className="input-field resize-none py-2 font-sans"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createTicketMutation.isPending || !ticketTitle || !ticketDesc}
                  className="btn-primary flex-1 justify-center"
                >
                  {createTicketMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  {createTicketMutation.isPending ? 'Procesando...' : 'Crear Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>,
    document.body
  )
}
