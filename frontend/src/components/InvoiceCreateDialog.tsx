/**
 * InvoiceCreateDialog — Modal premium para emitir facturas manuales a clientes.
 */
import { useState, useEffect } from 'react'
import { X, Loader2, Receipt, Calendar, User, CreditCard, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'

interface InvoiceCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  preselectedClientId?: string
  preselectedClientName?: string
  preselectedClientCedula?: string
  onSuccess?: () => void
}

interface FormPlan {
  id: string
  nombre: string
  precio: number
}

export function InvoiceCreateDialog({
  isOpen,
  onClose,
  preselectedClientId,
  preselectedClientName,
  preselectedClientCedula,
  onSuccess,
}: InvoiceCreateDialogProps) {
  const queryClient = useQueryClient()

  // Tab state
  const [activeTab, setActiveTab] = useState<'manual' | 'mensual'>('manual')

  // Form states
  const [clientId, setClientId] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [monto, setMonto] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  // Monthly Billing Trigger states
  const [generating, setGenerating] = useState(false)
  const [genSuccessMsg, setGenSuccessMsg] = useState<string | null>(null)

  // Cargar mes/año actual por defecto y resetear estados
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null)
      setGenSuccessMsg(null)
      setGenerating(false)
      setActiveTab('manual')
      setSelectedPlanId('')
      setMonto('')
      
      const today = new Date()
      const mm = String(today.getMonth() + 1).padStart(2, '0')
      const yyyy = today.getFullYear()
      setPeriodo(`${mm}/${yyyy}`)

      const expDate = new Date()
      expDate.setDate(today.getDate() + 10)
      const expY = expDate.getFullYear()
      const expM = String(expDate.getMonth() + 1).padStart(2, '0')
      const expD = String(expDate.getDate()).padStart(2, '0')
      setFechaVencimiento(`${expY}-${expM}-${expD}`)

      if (preselectedClientId) {
        setClientId(preselectedClientId)
        setClientSearch(preselectedClientName || '')
      } else {
        setClientId('')
        setClientSearch('')
      }
    }
  }, [isOpen, preselectedClientId, preselectedClientName])

  // Obtener Planes
  const { data: plans = [] } = useQuery<FormPlan[]>({
    queryKey: ['plans-invoice-create'],
    queryFn: async () => {
      const { data } = await api.get('/plans')
      return data
    },
    enabled: isOpen,
  })

  // Obtener Clientes (Búsqueda)
  const { data: searchedClients = [], isLoading: searchLoading } = useQuery({
    queryKey: ['clients-invoice-search', clientSearch],
    queryFn: async () => {
      if (!clientSearch.trim()) return []
      const { data } = await api.get('/clients', {
        params: { search: clientSearch, limit: 10 }
      })
      return data.items
    },
    enabled: isOpen && !preselectedClientId && clientSearch.length >= 2,
  })

  // Autofill monto al seleccionar un plan
  const handlePlanChange = (planId: string) => {
    setSelectedPlanId(planId)
    if (planId) {
      const plan = plans.find(p => p.id === planId)
      if (plan) {
        setMonto(plan.precio.toString())
      }
    } else {
      setMonto('')
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) {
        throw new Error('Debe seleccionar un cliente.')
      }

      const payload = {
        cliente_id: clientId,
        plan_id: selectedPlanId || null,
        periodo: periodo.trim(),
        monto: parseFloat(monto),
        fecha_vencimiento: `${fechaVencimiento}T23:59:59`,
      }

      const { data } = await api.post('/invoices', payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] })
      if (onSuccess) onSuccess()
      onClose()
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail ?? err.message ?? 'Fallo al registrar la factura'
      setErrorMsg(msg)
    }
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      setGenerating(true)
      setGenSuccessMsg(null)
      setErrorMsg(null)
      const { data } = await api.post('/invoices/generate-monthly')
      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['client-invoices'] })
      setGenSuccessMsg(`Se generaron exitosamente ${data.invoices_created} facturas para el mes actual.`)
      setGenerating(false)
      if (onSuccess) onSuccess()
      // Cerrar tras 3 segundos para que vean el mensaje
      setTimeout(() => {
        setGenSuccessMsg(null)
        onClose()
      }, 3000)
    },
    onError: (err: any) => {
      setGenerating(false)
      setErrorMsg(err.response?.data?.detail ?? 'Error al disparar facturación mensual')
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (!clientId) {
      setErrorMsg('Debe buscar y seleccionar un cliente de la lista.')
      return
    }

    const parsedMonto = parseFloat(monto)
    if (isNaN(parsedMonto) || parsedMonto <= 0) {
      setErrorMsg('El monto debe ser un número mayor a 0.')
      return
    }

    const periodPattern = /^(0[1-9]|1[0-2])\/\d{4}$/
    if (!periodPattern.test(periodo)) {
      setErrorMsg('El periodo debe tener el formato MM/AAAA (ej. 06/2026).')
      return
    }

    createMutation.mutate()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-card w-full max-w-md shadow-2xl relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Receipt className="w-5 h-5 text-brand-400" />
            <span>{preselectedClientId ? 'Emitir Factura Manual' : 'Generar Factura'}</span>
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector (only when no preselected client) */}
        {!preselectedClientId && (
          <div className="flex border-b border-border bg-secondary/10 shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('manual')
                setErrorMsg(null)
              }}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer text-center ${
                activeTab === 'manual'
                  ? 'border-brand-500 text-brand-400 bg-secondary/20'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Factura Manual
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('mensual')
                setErrorMsg(null)
              }}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-all cursor-pointer text-center ${
                activeTab === 'mensual'
                  ? 'border-brand-500 text-brand-400 bg-secondary/20'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Facturación Mensual
            </button>
          </div>
        )}

        {/* Content */}
        {activeTab === 'manual' ? (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            {/* Selector de Cliente */}
            <div className="space-y-1.5 relative">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Cliente *
              </label>
              {preselectedClientId ? (
                <div className="p-3 bg-secondary/40 border border-border/60 rounded-lg flex items-center gap-3">
                  <User className="w-4 h-4 text-brand-400" />
                  <div>
                    <span className="text-sm font-semibold text-foreground block">{preselectedClientName}</span>
                    <span className="text-xs text-muted-foreground font-mono">{preselectedClientCedula}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <input
                      type="text"
                      value={clientSearch}
                      onChange={(e) => {
                        setClientSearch(e.target.value)
                        setClientId('')
                        setShowDropdown(true)
                      }}
                      onFocus={() => setShowDropdown(true)}
                      placeholder="Escriba nombre o cédula para buscar..."
                      className="input-field"
                    />
                    {searchLoading && (
                      <Loader2 className="w-4 h-4 animate-spin text-brand-400 absolute right-3 top-3" />
                    )}
                  </div>

                  {/* Dropdown de Clientes */}
                  {showDropdown && clientSearch.length >= 2 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-secondary border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {searchedClients.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground italic text-center">
                          No se encontraron clientes
                        </div>
                      ) : (
                        searchedClients.map((c: any) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setClientId(c.id)
                              setClientSearch(c.nombre)
                              setShowDropdown(false)
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-secondary-hover border-b border-border/30 last:border-b-0 flex flex-col text-xs"
                          >
                            <span className="font-semibold text-foreground">{c.nombre}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{c.cedula}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Selector de Plan */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Concepto / Plan Base <span className="text-[10px] lowercase text-muted-foreground">(opcional)</span>
              </label>
              <select
                value={selectedPlanId}
                onChange={(e) => handlePlanChange(e.target.value)}
                className="input-field cursor-pointer"
              >
                <option value="">-- Sin Plan (Monto Personalizado) --</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} (${Number(p.precio).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            {/* Campo Monto */}
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
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0.00"
                  className="input-field pl-7 font-mono font-bold text-brand-300"
                />
              </div>
            </div>

            {/* Fila Periodo y Vencimiento */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Periodo (MM/AAAA) *
                </label>
                <input
                  type="text"
                  required
                  value={periodo}
                  onChange={(e) => setPeriodo(e.target.value)}
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
                  value={fechaVencimiento}
                  onChange={(e) => setFechaVencimiento(e.target.value)}
                  className="input-field font-mono cursor-pointer"
                />
              </div>
            </div>

            {/* Actions */}
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
                disabled={createMutation.isPending}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Creando...
                  </>
                ) : (
                  <>
                    <Receipt className="w-4 h-4" /> Emitir Factura
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {genSuccessMsg && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-emerald-400 text-xs font-semibold flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
                  <span>{genSuccessMsg}</span>
                </div>
              )}

              <div className="bg-brand-500/5 border border-brand-500/15 rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4 text-brand-400" />
                  <span>Facturación Masiva en Lote</span>
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                  Genera de manera automática las facturas para todos los clientes activos del WISP que tengan un plan contratado vigente.
                </p>
                <p className="text-[11px] text-brand-400/80 leading-normal italic bg-brand-500/10 p-2 rounded-lg">
                  * El sistema omitirá de manera inteligente la facturación para aquellos clientes que ya tengan una factura emitida para el mes actual.
                </p>
              </div>

              {/* Confirmation card integrated into the modal */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-1.5">
                <p className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span>¿Desea generar las facturas de todos los clientes activos para el periodo mensual actual?</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Al confirmar, se iniciará el proceso en lote. Esto no duplicará facturas existentes para el periodo.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-border mt-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-secondary/40 text-foreground border border-border hover:bg-secondary/70 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={generating}
                onClick={() => {
                  generateMutation.mutate()
                }}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Procesando...
                  </>
                ) : (
                  <>
                    <Receipt className="w-4 h-4" /> Generar Facturas del Mes
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
