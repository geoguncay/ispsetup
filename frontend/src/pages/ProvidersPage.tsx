/**
 * ProvidersPage — Gestión de proveedores.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Search, Truck, Edit2, Trash2, X, Loader2, Save, FileText } from 'lucide-react'
import api from '@/services/api'

interface Supplier {
  id: string
  name: string
  ruc: string
  phone: string
  email: string | null
  address: string
  notes: string | null
}

export function ProvidersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  
  // Form State
  const [name, setName] = useState('')
  const [ruc, setRuc] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Query suppliers
  const { data: suppliers = [], isLoading, refetch } = useQuery<Supplier[]>({
    queryKey: ['suppliers', search],
    queryFn: async () => {
      const params = search.trim() ? { search } : undefined
      const { data } = await api.get('/suppliers', { params })
      return data
    }
  })

  // Open form for create/edit
  const handleOpenForm = (supplier?: Supplier) => {
    setErrorMsg(null)
    if (supplier) {
      setEditingSupplier(supplier)
      setName(supplier.name)
      setRuc(supplier.ruc)
      setPhone(supplier.phone)
      setEmail(supplier.email || '')
      setAddress(supplier.address)
      setNotes(supplier.notes || '')
    } else {
      setEditingSupplier(null)
      setName('')
      setRuc('')
      setPhone('')
      setEmail('')
      setAddress('')
      setNotes('')
    }
    setFormOpen(true)
  }

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        ruc: ruc.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        address: address.trim(),
        notes: notes.trim() || null,
      }
      if (editingSupplier) {
        await api.put(`/suppliers/${editingSupplier.id}`, payload)
      } else {
        await api.post('/suppliers', payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setFormOpen(false)
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail ?? 'Error al guardar el proveedor')
    }
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (confirm('¿Está seguro de eliminar este proveedor? Se eliminarán las asociaciones con los productos en stock.')) {
        await api.delete(`/suppliers/${id}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['inventory'] }) // Por si afecta asociación
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !ruc || !phone || !address) {
      setErrorMsg('Por favor complete todos los campos obligatorios.')
      return
    }
    saveMutation.mutate()
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Proveedores</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="btn-secondary"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={() => handleOpenForm()}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Nuevo Proveedor
          </button>
        </div>
      </div>

      {/* Search Filter */}
      <div className="glass-card p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nombre, RUC o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
      </div>

      {/* Content Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Truck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No hay proveedores registrados</h3>
          <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
            Registra los proveedores que suministran tus routers, cables y demás equipamiento tecnológico.
          </p>
          <button onClick={() => handleOpenForm()} className="btn-primary mx-auto">
            <Plus className="w-4 h-4" />
            Registrar Proveedor
          </button>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>RUC</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Dirección</th>
                <th className="w-24 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-secondary/40 transition-colors">
                  <td className="font-semibold text-foreground">{s.name}</td>
                  <td className="font-mono text-xs text-muted-foreground">{s.ruc}</td>
                  <td className="text-sm text-foreground">{s.phone}</td>
                  <td className="text-sm text-muted-foreground">{s.email ?? '—'}</td>
                  <td className="text-sm text-muted-foreground truncate max-w-xs">{s.address}</td>
                  <td>
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleOpenForm(s)}
                        className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-brand-400"
                        title="Editar"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(s.id)}
                        className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-muted-foreground hover:text-red-400"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Dialog */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="glass-card w-full max-w-lg shadow-2xl relative flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Truck className="w-5 h-5 text-brand-400" />
                <span>{editingSupplier ? 'Editar Proveedor' : 'Registrar Proveedor'}</span>
              </h3>
              <button
                onClick={() => setFormOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Content */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
              {errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              {/* Nombre */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Razón Social / Nombre Comercial *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  placeholder="Ej. Distribuidora del Austro"
                />
              </div>

              {/* RUC y Telefono */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                    RUC / Identificación *
                  </label>
                  <input
                    type="text"
                    required
                    value={ruc}
                    onChange={(e) => setRuc(e.target.value)}
                    className="input-field font-mono"
                    placeholder="1798765432001"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                    Teléfono *
                  </label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="input-field"
                    placeholder="0998887766"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Correo Electrónico
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="contacto@proveedor.com"
                />
              </div>

              {/* Dirección */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Dirección Física *
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="input-field"
                  placeholder="Av. Principal y Secundaria, Quito"
                />
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Notas u Observaciones
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input-field h-20 resize-none py-2"
                  placeholder="Referencias de pago, líneas de crédito, etc."
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="flex-1 bg-secondary/40 text-foreground border border-border hover:bg-secondary/70 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-brand-600/20 disabled:opacity-50"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" /> Guardar
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
