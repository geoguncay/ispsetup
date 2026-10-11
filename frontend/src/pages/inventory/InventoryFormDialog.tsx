/**
 * InventoryFormDialog — Modal para crear y editar artículos de inventario.
 */
import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Save, Package, Edit2, Plus, Check } from 'lucide-react'
import api from '@/services/api'

interface Supplier {
  id: string
  name: string
}

interface ProductCategory {
  id: string
  name: string
}

interface InventoryItem {
  id: string
  name: string
  code: string
  quantity: number
  min_alert: number
  purchase_price: number
  sale_price: number
  description: string | null
  category: string | null
  model: string | null
  supplier_id: string | null
  supplier: Supplier | null
}

interface InventoryFormDialogProps {
  isOpen: boolean
  onClose: () => void
  item?: InventoryItem | null
  onSuccess: () => void
}

export function InventoryFormDialog({ isOpen, onClose, item, onSuccess }: InventoryFormDialogProps) {
  const queryClient = useQueryClient()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Form State
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [quantity, setQuantity] = useState<string>('0')
  const [minAlert, setMinimoAlerta] = useState<string>('5')
  const [purchasePrice, setPrecioCompra] = useState<string>('0.00')
  const [salePrice, setPrecioVenta] = useState<string>('0.00')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [model, setModel] = useState('')
  const [supplierId, setProveedorId] = useState('')

  // Category inline state
  const [categoryInput, setCategoryInput] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [categoryEditName, setCategoryEditName] = useState('')

  // Query suppliers list
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers-list-dropdown'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers')
      return data
    },
    enabled: isOpen,
  })

  // Query categories list
  const { data: categories = [] } = useQuery<ProductCategory[]>({
    queryKey: ['inventory-categories'],
    queryFn: async () => {
      const { data } = await api.get('/inventory/categories')
      return data
    },
    enabled: isOpen,
  })

  // Synchronize state when modal opens or editing item changes
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null)
      setCategoryInput('')
      setEditingCategoryId(null)
      setCategoryEditName('')
      if (item) {
        setName(item.name)
        setCode(item.code)
        setQuantity(item.quantity.toString())
        setMinimoAlerta(item.min_alert.toString())
        setPrecioCompra(item.purchase_price.toString())
        setPrecioVenta(item.sale_price.toString())
        setDescription(item.description || '')
        setCategory(item.category || '')
        setModel(item.model || '')
        setProveedorId(item.supplier_id || '')
      } else {
        setName('')
        setCode('')
        setQuantity('0')
        setMinimoAlerta('5')
        setPrecioCompra('0.00')
        setPrecioVenta('0.00')
        setDescription('')
        setCategory('')
        setModel('')
        setProveedorId('')
      }
    }
  }, [isOpen, item])

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post('/inventory/categories', { name })
      return data as ProductCategory
    },
    onSuccess: (newCat) => {
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] })
      setCategory(newCat.name)
      setCategoryInput('')
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail ?? 'Error al crear la categoría')
    },
  })

  // Update category mutation
  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data } = await api.put(`/inventory/categories/${id}`, { name })
      return data as ProductCategory
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['inventory-categories'] })
      setCategory(updated.name)
      setEditingCategoryId(null)
      setCategoryEditName('')
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail ?? 'Error al renombrar la categoría')
    },
  })

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        code: code.trim(),
        quantity: parseInt(quantity) || 0,
        min_alert: parseInt(minAlert) || 0,
        purchase_price: parseFloat(purchasePrice) || 0.0,
        sale_price: parseFloat(salePrice) || 0.0,
        description: description.trim() || null,
        category: category === '__new__' ? null : (category || null),
        model: model.trim() || null,
        supplier_id: supplierId || null,
      }
      if (item) {
        await api.put(`/inventory/${item.id}`, payload)
      } else {
        await api.post('/inventory', payload)
      }
    },
    onSuccess: () => {
      onSuccess()
      onClose()
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail ?? 'Error al guardar el producto')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !code || quantity === '') {
      setErrorMsg('Por favor complete todos los campos obligatorios.')
      return
    }
    saveMutation.mutate()
  }

  const handleCategorySelectChange = (value: string) => {
    setCategory(value)
    setCategoryInput('')
    setEditingCategoryId(null)
    setCategoryEditName('')
  }

  const selectedCategory = categories.find(c => c.name === category)

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-card w-full max-w-2xl shadow-2xl relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Package className="w-5 h-5 text-brand-400" />
            <span>{item ? 'Editar Artículo' : 'Registrar Artículo'}</span>
          </h3>
          <button
            onClick={onClose}
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

          {/* Nombre, Modelo y Codigo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Nombre del Producto *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                placeholder="Ej. Router Mikrotik"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Modelo
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="input-field"
                placeholder="Ej. hAP ac2"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Código / SKU *
              </label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input-field font-mono"
                placeholder="MTK-HAPAC2"
              />
            </div>
          </div>

          {/* Cantidad y Minimo Alerta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Cantidad en Stock *
              </label>
              <input
                type="number"
                required
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="input-field font-mono"
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Stock Mínimo para Alerta
              </label>
              <input
                type="number"
                min="0"
                value={minAlert}
                onChange={(e) => setMinimoAlerta(e.target.value)}
                className="input-field font-mono"
                placeholder="5"
              />
            </div>
          </div>

          {/* Precios compra / venta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Precio Compra ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPrecioCompra(e.target.value)}
                className="input-field font-mono"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Precio Venta ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={salePrice}
                onChange={(e) => setPrecioVenta(e.target.value)}
                className="input-field font-mono"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Categoría y Proveedor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Categoría con creación/edición inline */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Categoría del Producto
              </label>

              {/* Select row */}
              <div className="flex gap-2">
                <select
                  value={category}
                  onChange={(e) => handleCategorySelectChange(e.target.value)}
                  className="input-field cursor-pointer text-sm flex-1"
                >
                  <option value="">Sin Categoría</option>
                  {/* Preserve unknown legacy category name */}
                  {category && category !== '__new__' && !categories.some(c => c.name === category) && (
                    <option value={category}>{category}</option>
                  )}
                  {categories.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                  <option value="__new__">+ Crear nueva categoría...</option>
                </select>

                {/* Edit button — only when an API-known category is selected */}
                {selectedCategory && !editingCategoryId && (
                  <button
                    type="button"
                    title="Editar name de categoría"
                    onClick={() => {
                      setEditingCategoryId(selectedCategory.id)
                      setCategoryEditName(selectedCategory.name)
                    }}
                    className="p-2 border border-border hover:bg-secondary rounded-lg text-muted-foreground hover:text-brand-400 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* New category input */}
              {category === '__new__' && (
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    type="text"
                    value={categoryInput}
                    onChange={(e) => setCategoryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (categoryInput.trim()) createCategoryMutation.mutate(categoryInput.trim())
                      }
                    }}
                    placeholder="Nombre de la nueva categoría..."
                    className="input-field flex-1 text-sm"
                  />
                  <button
                    type="button"
                    disabled={!categoryInput.trim() || createCategoryMutation.isPending}
                    onClick={() => categoryInput.trim() && createCategoryMutation.mutate(categoryInput.trim())}
                    className="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                  >
                    {createCategoryMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Plus className="w-3.5 h-3.5" />}
                    Agregar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCategory(''); setCategoryInput('') }}
                    className="p-2 hover:bg-secondary rounded-lg text-muted-foreground transition-colors shrink-0"
                    title="Cancelar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Edit category name inline */}
              {editingCategoryId && (
                <div className="flex gap-2 items-center">
                  <input
                    autoFocus
                    type="text"
                    value={categoryEditName}
                    onChange={(e) => setCategoryEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (categoryEditName.trim()) {
                          updateCategoryMutation.mutate({ id: editingCategoryId, name: categoryEditName.trim() })
                        }
                      }
                    }}
                    className="input-field flex-1 text-sm"
                    placeholder="Nuevo name..."
                  />
                  <button
                    type="button"
                    disabled={!categoryEditName.trim() || updateCategoryMutation.isPending}
                    onClick={() => categoryEditName.trim() && updateCategoryMutation.mutate({ id: editingCategoryId, name: categoryEditName.trim() })}
                    className="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                  >
                    {updateCategoryMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Check className="w-3.5 h-3.5" />}
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingCategoryId(null); setCategoryEditName('') }}
                    className="p-2 hover:bg-secondary rounded-lg text-muted-foreground transition-colors shrink-0"
                    title="Cancelar"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Proveedor Asociado
              </label>
              <select
                value={supplierId}
                onChange={(e) => setProveedorId(e.target.value)}
                className="input-field cursor-pointer text-sm"
              >
                <option value="">-- Seleccionar Proveedor --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Descripcion */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Descripción / Características
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field h-20 resize-none py-2"
              placeholder="Ej. Router doble banda 2.4/5GHz, 5 puertos gigabit..."
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
    </div>,
    document.body
  )
}
