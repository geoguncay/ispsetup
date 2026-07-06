/**
 * PaymentRegisterDialog — Modal para registrar cobros manuales de facturas.
 */
import { useState, useEffect } from 'react'
import { X, Loader2, DollarSign, FileText, CheckCircle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'

interface PaymentRegisterDialogProps {
  isOpen: boolean
  onClose: () => void
  invoice: {
    id: string
    client_name: string
    client_cedula: string
    period: string
    amount: number
    status: string
  } | null
  onSuccess?: () => void
}

export function PaymentRegisterDialog({
  isOpen,
  onClose,
  invoice,
  onSuccess,
}: PaymentRegisterDialogProps) {
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState<string>('')
  const [method, setMethod] = useState<string>('cash')
  const [notes, setNotes] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [methods, setMethods] = useState<{ value: string; label: string }[]>([])

  // Sincronizar monto por defecto cuando se abre con una factura
  useEffect(() => {
    if (invoice) {
      setAmount(invoice.amount.toString())

      const saved = localStorage.getItem('isp_payment_methods')
      let loadedMethods = [
        { value: 'cash', label: 'Efectivo' },
        { value: 'transfer', label: 'Transferencia' },
        { value: 'card', label: 'Tarjeta' },
        { value: 'deposit', label: 'Depósito' }
      ]
      if (saved) {
        try {
          loadedMethods = JSON.parse(saved)
        } catch (e) {
          // ignore
        }
      } else {
        localStorage.setItem('isp_payment_methods', JSON.stringify(loadedMethods))
      }
      setMethods(loadedMethods)

      if (loadedMethods.length > 0) {
        setMethod(loadedMethods[0].value)
      } else {
        setMethod('cash')
      }
      setNotes('')
      setErrorMsg(null)
    }
  }, [invoice, isOpen])

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) return

      const payload = {
        invoice_id: invoice.id,
        amount: parseFloat(amount),
        method: method,
        notes: notes.trim() || null,
      }

      const { data } = await api.post('/payments', payload)
      return data
    },
    onSuccess: () => {
      // Invalidar cache de queries afectadas para recargar datos reales
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['client-payments'] })
      queryClient.invalidateQueries({ queryKey: ['today-cash'] })
      queryClient.invalidateQueries({ queryKey: ['client'] }) // Para actualizar estado activo del cliente

      if (onSuccess) onSuccess()
      onClose()
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail ?? 'Fallo al registrar el pago'
      setErrorMsg(msg)
    }
  })

  if (!isOpen || !invoice) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const parsedAmount = parseFloat(amount)
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('El monto debe ser un número superior a 0')
      return
    }

    registerMutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-card w-full max-w-md shadow-2xl relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400" />
            <span>Registrar Pago Manual</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* Resumen Factura */}
          <div className="p-4 bg-secondary/30 border border-border/60 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" /> Detalle de la Obligación
            </h4>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs block">Cliente</span>
                <span className="font-semibold text-foreground truncate block">{invoice.client_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Cédula / RUC</span>
                <span className="font-semibold text-foreground font-mono block">{invoice.client_cedula}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Periodo</span>
                <span className="font-semibold text-foreground block">{invoice.period}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Monto Factura</span>
                <span className="font-bold text-brand-400 font-mono block">${invoice.amount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Input Monto Cobrado */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Monto a Cobrar ($)
            </label>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field font-mono text-base font-bold text-brand-300"
              placeholder="0.00"
            />
          </div>

          {/* Selector Métodos Pago */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Método de Pago
            </label>
            <div className="grid grid-cols-2 gap-2">
              {methods.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer text-center ${
                    method === m.value
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-secondary/40 text-muted-foreground border-border hover:bg-secondary/60 hover:text-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notas / Referencia */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Referencia / Notas (Opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Transferencia Banco Pichincha Nº 829302"
              className="input-field"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary/40 text-foreground border border-border hover:bg-secondary/70 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={registerMutation.isPending}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
            >
              {registerMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Registrando...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" /> Confirmar Cobro
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
