/**
 * Ajustes de Sistema — contenedor de la pestaña "Método de Pago" en SettingsPage.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard, Plus, Check, X, Edit2, Trash2, Loader2 } from 'lucide-react'
import { getSystemSettings, updateCatalogs, type CatalogSettings, type PaymentMethodItem } from '@/services/systemSettings'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

const DEFAULT_PAYMENT_METHODS: PaymentMethodItem[] = [
  { value: 'cash', label: 'Efectivo', isSystem: true },
  { value: 'transfer', label: 'Transferencia', isSystem: true },
  { value: 'card', label: 'Tarjeta', isSystem: true },
  { value: 'deposit', label: 'Depósito', isSystem: true },
]
const SYSTEM_VALUES = ['cash', 'transfer', 'card', 'deposit']

function PaymentMethodsSettingsForm({
  data, onSaved, setStatusMessage,
}: { data: CatalogSettings; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([])
  const [newMethodLabel, setNewMethodLabel] = useState('')
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const mutation = useMutation({
    mutationFn: updateCatalogs,
    onSuccess: () => onSaved(),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar el catálogo.' })
    },
  })

  useEffect(() => {
    const loaded = data.payment_methods
    if (loaded && loaded.length > 0) {
      const withSystemFlag = loaded.map((p) => (SYSTEM_VALUES.includes(p.value) ? { ...p, isSystem: true } : p))
      setPaymentMethods(withSystemFlag)
    } else {
      setPaymentMethods(DEFAULT_PAYMENT_METHODS)
      mutation.mutate({ payment_methods: DEFAULT_PAYMENT_METHODS })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.payment_methods])

  const handleAddPaymentMethod = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMethodLabel.trim()) return

    const cleanLabel = newMethodLabel.trim()
    const cleanValue = cleanLabel
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/(^_|_$)/g, '')

    if (!cleanValue) {
      setStatusMessage({ type: 'error', text: 'El nombre del método de pago no es válido.' })
      return
    }

    if (paymentMethods.some((p) => p.value === cleanValue)) {
      setStatusMessage({ type: 'error', text: 'Este método de pago ya existe.' })
      return
    }

    const updated = [...paymentMethods, { value: cleanValue, label: cleanLabel }]
    setPaymentMethods(updated)
    mutation.mutate({ payment_methods: updated })
    setNewMethodLabel('')
    setStatusMessage({ type: 'success', text: `Método de pago "${cleanLabel}" agregado correctamente.` })
  }

  const handleDeletePaymentMethod = (valueToDelete: string) => {
    const method = paymentMethods.find((p) => p.value === valueToDelete)
    if (method?.isSystem) {
      setStatusMessage({ type: 'error', text: 'No se pueden eliminar los métodos del sistema por defecto.' })
      return
    }

    const updated = paymentMethods.filter((p) => p.value !== valueToDelete)
    setPaymentMethods(updated)
    mutation.mutate({ payment_methods: updated })
    setStatusMessage({ type: 'success', text: 'Método de pago eliminado correctamente.' })
  }

  const handleSaveEdit = (value: string) => {
    if (!editingLabel.trim()) return

    const updated = paymentMethods.map((p) => (p.value === value ? { ...p, label: editingLabel.trim() } : p))

    setPaymentMethods(updated)
    mutation.mutate({ payment_methods: updated })
    setEditingValue(null)
    setStatusMessage({ type: 'success', text: 'Método de pago actualizado correctamente.' })
  }

  return (
    <div className="glass-card p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-400" />
          Gestión de Métodos de Pago
        </h3>
      </div>

      <form onSubmit={handleAddPaymentMethod} className="flex gap-3 max-w-md items-end">
        <div className="flex-1 space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
            Nuevo Método de Pago
          </label>
          <input
            type="text"
            value={newMethodLabel}
            onChange={(e) => setNewMethodLabel(e.target.value)}
            className="input-field"
            placeholder="Ej: PayPal, Binance, Western Union"
          />
        </div>
        <button type="submit" className="btn-primary select-none h-11 px-4">
          <Plus className="w-4 h-4" />
          Agregar
        </button>
      </form>

      <div className="border border-border/60 rounded-xl overflow-hidden bg-background/20">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-secondary/40 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3">Nombre visible (Label)</th>
              <th className="px-4 py-3">Código interno (Value)</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 text-sm">
            {paymentMethods.map((m) => (
              <tr key={m.value} className="hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-3">
                  {editingValue === m.value ? (
                    <input
                      type="text"
                      value={editingLabel}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      className="input-field py-1 px-2 text-sm max-w-[220px] font-sans"
                    />
                  ) : (
                    <span className="font-semibold text-foreground">{m.label}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.value}</td>
                <td className="px-4 py-3">
                  {m.isSystem ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                      Sistema
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                      Personalizado
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {editingValue === m.value ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(m.value)}
                          className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all cursor-pointer"
                          title="Guardar"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingValue(null)}
                          className="p-1 text-muted-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                          title="Cancelar"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingValue(m.value)
                            setEditingLabel(m.label)
                          }}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                          title="Editar nombre"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {!m.isSystem && (
                          <button
                            type="button"
                            onClick={() => handleDeletePaymentMethod(m.value)}
                            className="p-1 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                            title="Eliminar método de pago"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PaymentMethodsSettingsTab({ isAdmin, setStatusMessage }: { isAdmin: boolean; setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSystemSettings,
    enabled: isAdmin,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-settings'] })

  if (isLoading || !data) {
    return (
      <div className="glass-card p-12 flex items-center justify-center animate-fade-in">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PaymentMethodsSettingsForm data={data.catalogs} onSaved={invalidate} setStatusMessage={setStatusMessage} />
    </div>
  )
}
