/**
 * InvoicesPage — Portal global de gestión de facturas y cobros para ISP.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Receipt, Search, Filter, AlertTriangle, CheckCircle2, Clock,
  Download, PlusCircle, RefreshCw, CreditCard, User, AlertCircle
} from 'lucide-react'
import api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { PaymentRegisterDialog } from '@/components/PaymentRegisterDialog'
import { InvoiceCreateDialog } from '@/components/InvoiceCreateDialog'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'

export function InvoicesPage() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const dateFormat = useDateFormat()

  // Filtros locales
  const [search, setSearch] = useState('')
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'overdue' | 'paid'>('all')
  const [onlyOverdue, setOnlyOverdue] = useState(false)

  // Estado para Diálogo de Cobro
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null)
  const [receiptLoadingMap, setReceiptLoadingMap] = useState<Record<string, boolean>>({})

  // Consultar facturas de la API
  const { data: invoices = [], isLoading, error } = useQuery({
    queryKey: ['invoices', statusFilter, onlyOverdue],
    queryFn: async () => {
      const params: any = {}
      if (statusFilter !== 'all') {
        params.status = statusFilter
      }
      if (onlyOverdue) {
        params.overdue = true
      }
      const { data } = await api.get('/invoices', { params })
      return data
    }
  })

  // Descargar Recibo PDF mediante Fetch de Blob
  const handleDownloadReceipt = async (paymentId: string) => {
    if (!paymentId) return

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

  // Filtrado por búsqueda en cliente o cédula
  const filteredInvoices = invoices.filter((inv: any) => {
    const term = search.toLowerCase()
    const name = (inv.client_name ?? '').toLowerCase()
    const doc = (inv.client_cedula ?? '').toLowerCase()
    return name.includes(term) || doc.includes(term)
  })

  // Calcular métricas rápidas basadas en el listado completo consultado
  const totalInvoices = invoices.length
  const totalAmount = invoices.reduce((sum: number, i: any) => sum + Number(i.amount), 0)
  const pendingAmount = invoices.filter((i: any) => i.status === 'pending').reduce((sum: number, i: any) => sum + Number(i.amount), 0)
  const overdueAmount = invoices.filter((i: any) => i.status === 'overdue').reduce((sum: number, i: any) => sum + Number(i.amount), 0)
  const collectedAmount = invoices.filter((i: any) => i.status === 'paid').reduce((sum: number, i: any) => sum + Number(i.amount), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="w-7 h-7 text-primary" />
            <span>Gestión de Facturas y Cobranzas</span>
          </h2>
        </div>

        <div className="w-full sm:w-auto">
          <button
            onClick={() => setInvoiceCreateOpen(true)}
            className="w-full sm:w-auto bg-primary hover:bg-primary-hover text-primary-foreground font-semibold px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Generar Factura</span>
          </button>
        </div>
      </div>

      {/* Tarjetas de Métricas Rápidas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Recaudado (Filtro)</span>
              <p className="text-2xl font-black text-emerald-400 font-mono">${collectedAmount.toFixed(2)}</p>
            </div>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Pendiente (Filtro)</span>
              <p className="text-2xl font-black text-amber-400 font-mono">${pendingAmount.toFixed(2)}</p>
            </div>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Vencido (Filtro)</span>
              <p className="text-2xl font-black text-rose-500 font-mono">${overdueAmount.toFixed(2)}</p>
            </div>
            <div className="p-2 bg-rose-500/10 rounded-lg text-rose-500">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="glass-card p-5 relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Total Facturado</span>
              <p className="text-2xl font-black text-foreground font-mono">${totalAmount.toFixed(2)}</p>
            </div>
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Receipt className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Controles de Búsqueda y Filtro */}
      <div className="glass-card p-4 flex flex-col lg:flex-row items-center justify-between gap-4">
        {/* Barra Búsqueda */}
        <div className="relative w-full lg:w-96">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente o cédula..."
            className="input-field pl-10"
          />
        </div>

        {/* Controles Filtro */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
          {/* Selector Estado */}
          <div className="flex bg-secondary/30 border border-border p-1 rounded-lg">
            {(['all', 'pending', 'overdue', 'paid'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer capitalize ${statusFilter === st
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {st === 'all' ? 'Ver Todos' : st}
              </button>
            ))}
          </div>

          {/* Switch Mora */}
          <label className="flex items-center gap-2 cursor-pointer bg-secondary/30 hover:bg-secondary/50 border border-border p-2 rounded-lg transition-all text-xs font-semibold">
            <input
              type="checkbox"
              checked={onlyOverdue}
              onChange={(e) => setOnlyOverdue(e.target.checked)}
              className="accent-primary rounded border-border"
            />
            <span className="text-muted-foreground">Solo Vencidas / Mora</span>
          </label>
        </div>
      </div>

      {/* Grid de Resultados */}
      {isLoading ? (
        <div className="text-center py-20 glass-card flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm font-medium">Cargando facturas del sistema...</span>
        </div>
      ) : error ? (
        <div className="text-center py-10 glass-card text-rose-400 font-semibold flex items-center justify-center gap-2">
          <AlertCircle className="w-5 h-5" /> Error al consultar facturas
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="text-center py-20 glass-card text-muted-foreground text-sm flex flex-col items-center gap-2">
          <Receipt className="w-12 h-12 text-muted-foreground/30" />
          No se encontraron facturas con los filtros seleccionados.
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Cédula</th>
                  <th>Periodo</th>
                  <th>Plan Base</th>
                  <th>Monto</th>
                  <th>Fecha Emisión</th>
                  <th>Fecha Vencimiento</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-secondary/20 transition-all">
                    <td>
                      <Link
                        to={`/clients/${inv.client_id}`}
                        className="font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
                      >
                        <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span>{inv.client_name ?? 'Cliente N/A'}</span>
                      </Link>
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{inv.client_cedula ?? 'N/A'}</td>
                    <td className="font-semibold text-foreground text-xs">{inv.period}</td>
                    <td>
                      <span className="text-xs bg-secondary/50 px-2 py-0.5 rounded border border-border text-foreground font-medium">
                        {inv.plan_name ?? 'Plan Eliminado'}
                      </span>
                    </td>
                    <td className="font-black text-brand-300 font-mono text-sm">${Number(inv.amount).toFixed(2)}</td>
                    <td className="text-xs text-muted-foreground font-mono">
                      {formatDate(inv.issue_date, dateFormat)}
                    </td>
                    <td className="text-xs text-muted-foreground font-mono">
                      {formatDate(inv.due_date, dateFormat)}
                    </td>
                    <td>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${inv.status === 'paid'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : inv.status === 'pending'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                        }`}>
                        {inv.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex gap-2 justify-end">
                        {(inv.status === 'pending' || inv.status === 'overdue') && (
                          <button
                            onClick={() => setSelectedInvoice(inv)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-all shadow-sm shadow-emerald-600/10"
                          >
                            <CreditCard className="w-3.5 h-3.5" /> Registrar Cobro
                          </button>
                        )}
                        {inv.status === 'paid' && inv.payment_id && (
                          <button
                            disabled={receiptLoadingMap[inv.payment_id]}
                            onClick={() => handleDownloadReceipt(inv.payment_id)}
                            className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-semibold text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                          >
                            {receiptLoadingMap[inv.payment_id] ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            Recibo PDF
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Registrar Pago */}
      <PaymentRegisterDialog
        isOpen={selectedInvoice !== null}
        onClose={() => setSelectedInvoice(null)}
        invoice={selectedInvoice}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['invoices'] })
        }}
      />

      {/* Modal Crear Factura */}
      <InvoiceCreateDialog
        isOpen={invoiceCreateOpen}
        onClose={() => setInvoiceCreateOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['invoices'] })
        }}
      />
    </div>
  )
}
