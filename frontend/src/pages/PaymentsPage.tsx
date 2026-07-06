/**
 * PaymentsPage — Control de caja del día y transacciones financieras del ISP.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  DollarSign, RefreshCw, Calendar, ArrowUpRight,
  CreditCard, Wallet, Download, Clock, Landmark, User, FileText
} from 'lucide-react'
import api from '@/services/api'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'

export function PaymentsPage() {
  const [receiptLoadingMap, setReceiptLoadingMap] = useState<Record<string, boolean>>({})
  const dateFormat = useDateFormat()

  // Consultar caja diaria de la API
  const { data: cashData = { total_collected: 0, breakdown: {}, transactions: [] }, isLoading, refetch } = useQuery({
    queryKey: ['today-cash'],
    queryFn: async () => {
      const { data } = await api.get('/payments/today')
      return data
    }
  })

  // Descargar Recibo PDF
  const handleDownloadReceipt = async (paymentId: string) => {
    setReceiptLoadingMap(prev => ({ ...prev, [paymentId]: true }))
    try {
      const response = await api.get(`/payments/${paymentId}/receipt`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `recibo_${paymentId.substring(0, 8).toUpperCase()}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert('Error al descargar el comprobante en PDF')
    } finally {
      setReceiptLoadingMap(prev => ({ ...prev, [paymentId]: false }))
    }
  }

  const { total_collected, breakdown, transactions } = cashData

  const cashTotal = breakdown.cash ?? 0
  const transferTotal = breakdown.transfer ?? 0
  const cardTotal = breakdown.card ?? 0
  const depositTotal = breakdown.deposit ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Wallet className="w-7 h-7 text-primary" />
            <span>Caja del Día</span>
          </h2>
        </div>

        {/* Refrescar */}
        <button
          onClick={() => refetch()}
          className="bg-secondary/40 hover:bg-secondary/60 text-foreground border border-border p-2.5 rounded-lg transition-all cursor-pointer flex items-center gap-2 text-sm font-semibold"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Sincronizar</span>
        </button>
      </div>

      {/* Grid de Totales en Glassmorphism */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* TOTAL GENERAL */}
        <div className="glass-card p-5 border border-primary/20 relative overflow-hidden bg-primary/5">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-primary block">Total Recaudado</span>
              <p className="text-2xl font-black text-foreground font-mono">${Number(total_collected).toFixed(2)}</p>
            </div>
            <div className="p-2 bg-primary/20 rounded-lg text-primary">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-[10px] text-muted-foreground gap-1">
            <Clock className="w-3.5 h-3.5" /> Hoy: {formatDate(new Date(), dateFormat)}
          </div>
        </div>

        {/* EFECTIVO */}
        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground block">Recaudado en Efectivo</span>
              <p className="text-2xl font-black text-emerald-400 font-mono">${Number(cashTotal).toFixed(2)}</p>
            </div>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* TRANSFERENCIA */}
        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground block">Transferencia Bancaria</span>
              <p className="text-2xl font-black text-brand-300 font-mono">${Number(transferTotal).toFixed(2)}</p>
            </div>
            <div className="p-2 bg-brand-500/10 rounded-lg text-brand-400">
              <Landmark className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* TARJETA */}
        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground block">Tarjeta Crédito / Débito</span>
              <p className="text-2xl font-black text-purple-400 font-mono">${Number(cardTotal).toFixed(2)}</p>
            </div>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* DEPOSITOS */}
        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground block">Depósitos en Cuenta</span>
              <p className="text-2xl font-black text-cyan-400 font-mono">${Number(depositTotal).toFixed(2)}</p>
            </div>
            <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Ledger del Historial de Cobros de Hoy */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Calendar className="w-4 h-4" /> Detalle de Cobros Registrados Hoy
        </h3>

        {isLoading ? (
          <div className="text-center py-20 glass-card flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm font-medium">Consultando transacciones del día...</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-16 glass-card text-muted-foreground text-sm flex flex-col items-center gap-2">
            <DollarSign className="w-12 h-12 text-muted-foreground/30" />
            No se han registrado cobros el día de hoy todavía.
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Cliente</th>
                    <th>Factura Relacionada</th>
                    <th>Método</th>
                    <th>Cobrado Por</th>
                    <th>Referencia / Notas</th>
                    <th>Monto</th>
                    <th className="text-right">Comprobante</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx: any) => (
                    <tr key={tx.id} className="hover:bg-secondary/20 transition-all text-sm">
                      <td className="font-mono text-xs text-muted-foreground">
                        {new Date(tx.payment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <Link
                          to={`/clients/${tx.client_id}`}
                          className="font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
                        >
                          <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span>{tx.client_name ?? 'Cliente N/A'}</span>
                        </Link>
                      </td>
                      <td>
                        <span className="text-xs bg-secondary/50 px-2 py-0.5 rounded border border-border text-foreground font-medium flex items-center gap-1.5 w-fit">
                          <FileText className="w-3 h-3 text-muted-foreground" />
                          <span>{tx.invoice_id ? 'Factura Mensual' : 'Abono'}</span>
                        </span>
                      </td>
                      <td className="capitalize font-medium text-foreground text-xs">{tx.method.replace("_", " ")}</td>
                      <td className="text-xs font-medium text-foreground">
                        <span className="text-muted-foreground">{tx.user_name ?? 'Sistema'}</span>
                      </td>
                      <td className="text-xs text-muted-foreground truncate max-w-xs">{tx.notes ?? '-'}</td>
                      <td className="font-black text-brand-300 font-mono text-base">${Number(tx.amount).toFixed(2)}</td>
                      <td className="text-right">
                        <button
                          disabled={receiptLoadingMap[tx.id]}
                          onClick={() => handleDownloadReceipt(tx.id)}
                          className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-semibold text-xs px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
                        >
                          {receiptLoadingMap[tx.id] ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>Comprobante PDF</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
