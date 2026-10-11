import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, FileText, Plus, CreditCard, Pencil, Trash2, Download, Ban, Wallet } from 'lucide-react'
import api from '@/services/api'
import { PaymentRegisterDialog } from '@/pages/billing/payments/PaymentRegisterDialog'
import { InvoiceEditDialog } from '@/pages/billing/invoices/InvoiceEditDialog'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'
import type { AddToast } from '../types'

interface BillingTabProps {
  clientId: string | undefined
  client: any
  addToast: AddToast
  onNewInvoice: () => void
  /** Se llama cuando un cobro o edición cambia el estado del cliente (para refrescarlo). */
  onClientChanged: () => void
}

/** Facturas emitidas e historial de pagos del cliente. */
export function BillingTab({ clientId: id, client, addToast, onNewInvoice, onClientChanged }: BillingTabProps) {
  const queryClient = useQueryClient()
  const dateFormat = useDateFormat()

  const [selectedInvoice, setSelectedInvoice] = useState<any>(null)
  const [receiptLoadingMap, setReceiptLoadingMap] = useState<Record<string, boolean>>({})
  const [voidInvoiceErrorMap, setVoidInvoiceErrorMap] = useState<Record<string, string>>({})
  const [confirmDeleteInvoiceId, setConfirmDeleteInvoiceId] = useState<string | null>(null)
  const [editingInvoice, setEditingInvoice] = useState<any>(null)
  const [deleteInvoiceErrorMsg, setDeleteInvoiceErrorMsg] = useState<string | null>(null)

  // Consultar Historial de Pagos
  const { data: payments = [], isLoading: isLoadingPayments } = useQuery({
    queryKey: ['client-payments', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/payments`)
      return data
    }
  })

  // Consultar Facturas del Cliente
  const { data: invoices = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['client-invoices', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/invoices`)
      return data
    }
  })

  // Descargar Recibo PDF mediante Fetch de Blob
  const handleDownloadReceipt = async (pagoId: string) => {
    if (!pagoId) return
    setReceiptLoadingMap(prev => ({ ...prev, [pagoId]: true }))
    try {
      const response = await api.get(`/payments/${pagoId}/receipt`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `recibo_${pagoId.substring(0, 8).toUpperCase()}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      addToast('Error al descargar el comprobante en PDF', 'error')
    } finally {
      setReceiptLoadingMap(prev => ({ ...prev, [pagoId]: false }))
    }
  }

  // Anular factura YA PAGADA (queda marcada como "cancelled" y también anula su pago)
  const voidInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await api.post(`/invoices/${invoiceId}/void`)
    },
    onSuccess: (_data, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
      setVoidInvoiceErrorMap(prev => { const next = { ...prev }; delete next[invoiceId]; return next })
    },
    onError: (err: any, invoiceId) => {
      const msg = err?.response?.data?.detail || 'Error al anular la factura'
      setVoidInvoiceErrorMap(prev => ({ ...prev, [invoiceId]: msg }))
    }
  })

  // Eliminar factura definitivamente (solo sin pagos asociados)
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await api.delete(`/invoices/${invoiceId}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
      setConfirmDeleteInvoiceId(null)
      setDeleteInvoiceErrorMsg(null)
    },
    onError: (err: any) => {
      setDeleteInvoiceErrorMsg(err?.response?.data?.detail || 'Error al eliminar la factura')
    }
  })

  return (
    <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Columna Facturas */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-border/40 pb-2">
                      <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" /> Facturas Emitidas
                      </h3>
                      <button
                        onClick={onNewInvoice}
                        className="btn-primary text-[10px] py-1 px-2.5 h-auto flex items-center gap-1 font-semibold"
                      >
                        <Plus className="w-3 h-3" /> Nueva Factura
                      </button>
                    </div>
                    {isLoadingInvoices ? (
                      <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Cargando facturas...
                      </div>
                    ) : invoices.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground bg-secondary/10 rounded-lg border border-border/50">Sin facturas emitidas.</p>
                    ) : (
                      <div className="overflow-x-auto font-sans glass-card p-2 border-border/40">
                        <table className="data-table text-xs">
                          <thead>
                            <tr>
                              <th>Periodo</th>
                              <th>Monto</th>
                              <th>Vence</th>
                              <th>Estado</th>
                              <th className="text-right">Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoices.map((inv: any) => (
                              <tr key={inv.id} className="hover:bg-secondary/20 transition-all">
                                <td className="font-bold text-foreground">
                                  {inv.period}
                                  {inv.concept && (
                                    <span className="block text-[9px] font-normal text-muted-foreground max-w-[160px] truncate" title={inv.concept}>
                                      {inv.concept}
                                    </span>
                                  )}
                                </td>
                                <td className="font-bold text-brand-400 font-mono">${Number(inv.amount).toFixed(2)}</td>
                                <td className="text-muted-foreground font-mono">{formatDate(inv.due_date, dateFormat)}</td>
                                <td>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${
                                    inv.status === 'paid'
                                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                      : inv.status === 'pending'
                                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                                        : inv.status === 'cancelled'
                                          ? 'bg-slate-500/10 text-slate-400 border-slate-500/25'
                                          : 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                                  }`}>
                                    {inv.status === 'cancelled' ? 'ANULADA' : inv.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="text-right">
                                  <div className="flex flex-col items-end gap-1">
                                    {(inv.status === 'pending' || inv.status === 'overdue') ? (
                                      <div className="flex gap-1.5 justify-end">
                                        <button
                                          onClick={() => setSelectedInvoice({
                                            ...inv,
                                            client_name: client?.full_name ?? 'Cliente',
                                            client_cedula: client?.cedula ?? 'N/A'
                                          })}
                                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit"
                                        >
                                          <CreditCard className="w-3 h-3" /> Cobrar
                                        </button>
                                        <button
                                          onClick={() => setEditingInvoice(inv)}
                                          title="Editar factura"
                                          className="bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                          onClick={() => { setConfirmDeleteInvoiceId(inv.id); setDeleteInvoiceErrorMsg(null) }}
                                          title="Eliminar factura"
                                          className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/25 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ) : inv.status === 'paid' ? (
                                      <div className="flex gap-1.5 justify-end">
                                        {inv.payment_id && (
                                          <button
                                            disabled={receiptLoadingMap[inv.payment_id]}
                                            onClick={() => handleDownloadReceipt(inv.payment_id)}
                                            className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit disabled:opacity-50"
                                          >
                                            {receiptLoadingMap[inv.payment_id] ? (
                                              <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : (
                                              <Download className="w-3 h-3" />
                                            )}
                                            PDF
                                          </button>
                                        )}
                                        <button
                                          disabled={voidInvoiceMutation.isPending}
                                          onClick={() => voidInvoiceMutation.mutate(inv.id)}
                                          title="Anular factura (también anula el pago)"
                                          className="bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground border border-border font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1 w-fit disabled:opacity-50"
                                        >
                                          <Ban className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground text-[10px]">-</span>
                                    )}
                                    {voidInvoiceErrorMap[inv.id] && (
                                      <span className="text-[9px] text-rose-400 max-w-[160px] text-right">{voidInvoiceErrorMap[inv.id]}</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Columna Historial Pagos */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-emerald-400" /> Historial de Pagos
                    </h3>
                    {isLoadingPayments ? (
                      <div className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Cargando pagos...
                      </div>
                    ) : payments.length === 0 ? (
                      <p className="text-center py-6 text-sm text-muted-foreground bg-secondary/10 rounded-lg border border-border/50">Sin cobros registrados.</p>
                    ) : (
                      <div className="overflow-x-auto font-sans glass-card p-2 border-border/40">
                        <table className="data-table text-xs">
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Monto</th>
                              <th>Método</th>
                              <th>Notas</th>
                              <th className="text-right">Comprobante</th>
                            </tr>
                          </thead>
                          <tbody>
                            {payments.map((p: any) => (
                              <tr key={p.id} className="hover:bg-secondary/20 transition-all">
                                <td className="text-muted-foreground font-mono">
                                  {formatDate(p.payment_date, dateFormat)}
                                </td>
                                <td className="font-bold text-emerald-400 font-mono">${Number(p.amount).toFixed(2)}</td>
                                <td className="capitalize font-medium text-foreground">{p.method}</td>
                                <td className="text-muted-foreground truncate max-w-[100px]" title={p.notes}>{p.notes ?? '-'}</td>
                                <td className="text-right">
                                  <button
                                    disabled={receiptLoadingMap[p.id]}
                                    onClick={() => handleDownloadReceipt(p.id)}
                                    className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-all flex items-center gap-1.5 ml-auto disabled:opacity-50"
                                  >
                                    {receiptLoadingMap[p.id] ? (
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Download className="w-3 h-3" />
                                    )}
                                    Recibo
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

      {/* Modal Registrar Pago */}
      <PaymentRegisterDialog
        isOpen={selectedInvoice !== null}
        onClose={() => setSelectedInvoice(null)}
        invoice={selectedInvoice}
        onSuccess={() => {
          onClientChanged()
          queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
          queryClient.invalidateQueries({ queryKey: ['client-payments', id] })
        }}
      />

      {/* Modal Editar Factura */}
      <InvoiceEditDialog
        isOpen={editingInvoice !== null}
        onClose={() => setEditingInvoice(null)}
        invoice={editingInvoice}
        onSuccess={() => {
          onClientChanged()
          queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
        }}
      />

      {/* Modal Confirmar Eliminación de Factura */}
      {confirmDeleteInvoiceId && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-sm mx-4 animate-fade-in">
            <h3 className="text-lg font-semibold text-foreground mb-2">¿Eliminar factura?</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Esta acción no se puede deshacer. Solo se puede eliminar si no tiene ningún pago registrado.
            </p>

            {deleteInvoiceErrorMsg && (
              <div className="p-3 mb-4 rounded bg-destructive/10 border border-destructive/20 text-destructive text-xs animate-fade-in">
                {deleteInvoiceErrorMsg}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmDeleteInvoiceId(null); setDeleteInvoiceErrorMsg(null) }}
                className="btn-secondary flex-1 justify-center"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteInvoiceMutation.mutate(confirmDeleteInvoiceId)}
                disabled={deleteInvoiceMutation.isPending}
                className="btn-destructive flex-1 justify-center"
              >
                {deleteInvoiceMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
