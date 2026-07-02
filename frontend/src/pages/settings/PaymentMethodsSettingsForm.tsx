import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CreditCard, Hash, Plus, Check, X, Edit2, Trash2 } from 'lucide-react'
import { updateCatalogs, type CatalogSettings, type PaymentMethodItem } from '@/services/systemSettings'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

const DEFAULT_PAYMENT_METHODS: PaymentMethodItem[] = [
  { value: 'efectivo', label: 'Efectivo', isSystem: true },
  { value: 'transferencia', label: 'Transferencia', isSystem: true },
  { value: 'tarjeta', label: 'Tarjeta', isSystem: true },
  { value: 'deposito', label: 'Depósito', isSystem: true },
]
const SYSTEM_VALUES = ['efectivo', 'transferencia', 'tarjeta', 'deposito']
const DEFAULT_FECHAS_CORTE = [1, 5, 10, 15, 28]

export function PaymentMethodsSettingsForm({
  data, onSaved, setStatusMessage,
}: { data: CatalogSettings; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([])
  const [newMethodLabel, setNewMethodLabel] = useState('')
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const [fechasCorte, setFechasCorte] = useState<number[]>([])
  const [newFechaCorteInput, setNewFechaCorteInput] = useState('')
  const [editingFechaCorteDay, setEditingFechaCorteDay] = useState<number | null>(null)
  const [editingFechaCorteVal, setEditingFechaCorteVal] = useState('')

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

  useEffect(() => {
    const loaded = data.fechas_corte
    if (loaded && loaded.length > 0) {
      setFechasCorte(loaded)
    } else {
      setFechasCorte(DEFAULT_FECHAS_CORTE)
      mutation.mutate({ fechas_corte: DEFAULT_FECHAS_CORTE })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.fechas_corte])

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

  const handleAddFechaCorte = (e: React.FormEvent) => {
    e.preventDefault()
    const val = parseInt(newFechaCorteInput.trim(), 10)
    if (isNaN(val) || val < 1 || val > 31) {
      setStatusMessage({ type: 'error', text: 'Ingrese un día válido entre 1 y 31.' })
      return
    }
    if (fechasCorte.includes(val)) {
      setStatusMessage({ type: 'error', text: `El día ${val} ya está en la lista.` })
      return
    }
    const updated = [...fechasCorte, val].sort((a, b) => a - b)
    setFechasCorte(updated)
    mutation.mutate({ fechas_corte: updated })
    setNewFechaCorteInput('')
    setStatusMessage({ type: 'success', text: `Día ${val} agregado como fecha de corte.` })
  }

  const handleDeleteFechaCorte = (day: number) => {
    const updated = fechasCorte.filter((d) => d !== day)
    setFechasCorte(updated)
    mutation.mutate({ fechas_corte: updated })
    setStatusMessage({ type: 'success', text: `Día ${day} eliminado.` })
  }

  const handleSaveFechaCorte = (oldDay: number) => {
    const val = parseInt(editingFechaCorteVal.trim(), 10)
    if (isNaN(val) || val < 1 || val > 31) {
      setStatusMessage({ type: 'error', text: 'Ingrese un día válido entre 1 y 31.' })
      return
    }
    if (val !== oldDay && fechasCorte.includes(val)) {
      setStatusMessage({ type: 'error', text: `El día ${val} ya existe en la lista.` })
      return
    }
    const updated = fechasCorte.map((d) => (d === oldDay ? val : d)).sort((a, b) => a - b)
    setFechasCorte(updated)
    mutation.mutate({ fechas_corte: updated })
    setEditingFechaCorteDay(null)
    setStatusMessage({ type: 'success', text: `Fecha de corte actualizada a día ${val}.` })
  }

  return (
    <div className="glass-card p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-brand-400" />
          Gestión de Métodos de Pago
        </h3>
        <p className="text-muted-foreground text-xs mt-1">
          Agrega, edita y administra los métodos de pago aceptados para registrar los cobros manuales y facturación de tus clientes.
        </p>
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

      <hr className="border-border/50" />

      {/* Fechas de Corte */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Hash className="w-5 h-5 text-brand-400" />
            Fechas de Corte Disponibles
          </h3>
          <span className="text-[10px] text-muted-foreground bg-secondary/40 px-2 py-0.5 rounded-full border border-border/40">
            {fechasCorte.length} fechas
          </span>
        </div>
        <p className="text-muted-foreground text-xs mb-5">
          Define los días del mes disponibles como "Fecha de corte" al registrar o editar un cliente. Los días se ordenan automáticamente.
        </p>

        <form onSubmit={handleAddFechaCorte} className="flex gap-3 max-w-md items-end mb-5">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Nuevo día (1 – 31)
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={newFechaCorteInput}
              onChange={(e) => setNewFechaCorteInput(e.target.value)}
              className="input-field font-mono"
              placeholder="Ej: 20"
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
                <th className="px-4 py-3">Día del mes</th>
                <th className="px-4 py-3">Etiqueta visible</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 text-sm">
              {fechasCorte.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-muted-foreground italic">
                    No hay fechas de corte configuradas.
                  </td>
                </tr>
              ) : (
                fechasCorte.map((dia) => (
                  <tr key={dia} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      {editingFechaCorteDay === dia ? (
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={editingFechaCorteVal}
                          onChange={(e) => setEditingFechaCorteVal(e.target.value)}
                          className="input-field py-1 px-2 text-sm font-mono w-24"
                          autoFocus
                        />
                      ) : (
                        <span className="font-mono font-bold text-foreground">{String(dia).padStart(2, '0')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      Día {dia} de cada mes
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {editingFechaCorteDay === dia ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveFechaCorte(dia)}
                              className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all cursor-pointer"
                              title="Guardar"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingFechaCorteDay(null)}
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
                              onClick={() => { setEditingFechaCorteDay(dia); setEditingFechaCorteVal(String(dia)) }}
                              className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded transition-all cursor-pointer"
                              title="Editar"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteFechaCorte(dia)}
                              className="p-1 text-destructive hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
