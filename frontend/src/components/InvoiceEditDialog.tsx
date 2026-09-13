/**
 * InvoiceEditDialog — Modal para editar una factura pendiente o vencida
 * (monto, periodo, vencimiento y concepto). No aplica a facturas pagadas o anuladas.
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Pencil } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import { formatDateInput } from '@/lib/dueDate'

interface InvoiceEditDialogProps {
  isOpen: boolean
  onClose: () => void
  invoice: {
    id: string
    period: string
    amount: number
    due_date: string
    issue_date: string
    concept?: string | null
  } | null
  onSuccess?: () => void
}

export function InvoiceEditDialog({ isOpen, onClose, invoice, onSuccess }: InvoiceEditDialogProps) {
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [concept, setConcept] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && invoice) {
      setAmount(String(invoice.amount))
      setPeriod(invoice.period)
      setDueDate(formatDateInput(new Date(invoice.due_date)))
      setConcept(invoice.concept || '')
      setErrorMsg(null)
    }
  }, [isOpen, invoice])

  const issueDateStr = invoice ? formatDateInput(new Date(invoice.issue_date)) : undefined

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) return
      await api.put(`/invoices/${invoice.id}`, {
        amount: parseFloat(amount),
        period: period.trim(),
        due_date: `${dueDate}T23:59:59`,
        concept: concept.trim() || null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] })
      if (onSuccess) onSuccess()
      onClose()
    },
    onError: (err: any) => {
      setErrorMsg(err?.response?.data?.detail || 'Error al editar la factura')
    }
  })

  if (!isOpen || !invoice) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('El monto debe ser un número mayor a 0.')
      return
    }

    const periodPattern = /^(0[1-9]|1[0-2])\/\d{4}$/
    if (!periodPattern.test(period)) {
      setErrorMsg('El periodo debe tener el formato MM/AAAA (ej. 06/2026).')
      return
    }

    if (issueDateStr && dueDate < issueDateStr) {
      setErrorMsg('La fecha de vencimiento no puede ser anterior a la fecha de emisión.')
      return
    }

    editMutation.mutate()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-card w-full max-w-md shadow-2xl relative flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Pencil className="w-5 h-5 text-brand-400" />
            <span>Editar Factura</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Monto Facturado ($) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-sm font-semibold">$</span>
              <input
                type="number"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-field pl-7 font-mono font-bold text-brand-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Periodo (MM/AAAA) *
              </label>
              <input
                type="text"
                required
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="06/2026"
                className="input-field font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Vence *
              </label>
              <input
                type="date"
                required
                min={issueDateStr}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-field font-mono cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Concepto / Nota <span className="text-[10px] lowercase text-muted-foreground">(opcional)</span>
            </label>
            <input
              type="text"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Descripción de la factura..."
              className="input-field"
              maxLength={255}
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-border mt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary/40 text-foreground border border-border hover:bg-secondary/70 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer text-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={editMutation.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50"
            >
              {editMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Guardando...
                </>
              ) : (
                <>
                  <Pencil className="w-4 h-4" /> Guardar Cambios
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
