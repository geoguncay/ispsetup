/**
 * InventoryPage — Gestión de stock/productos en inventario.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Search, Package, Edit2, Trash2, AlertTriangle, Truck, ArrowUpDown, ArrowUp, ArrowDown, Upload } from 'lucide-react'
import api from '@/services/api'
import { InventoryFormDialog } from '@/components/InventoryFormDialog'
import { InventoryImportDialog } from '@/components/InventoryImportDialog'

interface Supplier {
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

export function InventoryPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  // Sorting State
  const [sortField, setSortField] = useState<'code' | 'name' | 'model' | 'category' | 'quantity' | 'purchase_price' | 'sale_price' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  // Query inventory
  const { data: inventoryItems = [], isLoading, refetch } = useQuery<InventoryItem[]>({
    queryKey: ['inventory', search],
    queryFn: async () => {
      const params = search.trim() ? { search } : undefined
      const { data } = await api.get('/inventory', { params })
      return data
    }
  })

  // Open form for create/edit
  const handleOpenForm = (item?: InventoryItem) => {
    setEditingItem(item || null)
    setFormOpen(true)
  }

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (confirm('¿Está seguro de eliminar este producto del stock?')) {
        await api.delete(`/inventory/${id}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
    }
  })

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const renderSortIcon = (field: typeof sortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-muted-foreground/50 ml-1.5 inline-block" />
    }
    if (sortOrder === 'asc') {
      return <ArrowUp className="w-3 h-3 text-brand-400 ml-1.5 inline-block" />
    }
    return <ArrowDown className="w-3 h-3 text-brand-400 ml-1.5 inline-block" />
  }

  const sortedItems = [...inventoryItems].sort((a, b) => {
    if (!sortField) return 0
    const aVal = a[sortField] ?? ''
    const bVal = b[sortField] ?? ''

    if (sortField === 'quantity' || sortField === 'purchase_price' || sortField === 'sale_price') {
      return sortOrder === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal)
    }

    return sortOrder === 'asc'
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal))
  })


  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventario y Stock</h1>
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
            onClick={() => setImportOpen(true)}
            className="btn-secondary"
          >
            <Upload className="w-4 h-4" />
            Importar
          </button>
          <button
            onClick={() => handleOpenForm()}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Registrar Artículo
          </button>
        </div>
      </div>

      {/* Search Filter */}
      <div className="glass-card p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por name o SKU..."
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
      ) : inventoryItems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No hay artículos registrados</h3>
          <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
            Registra tu stock de routers, antenas CPE, bobinas de fibra, ONUs y consumibles.
          </p>
          <button onClick={() => handleOpenForm()} className="btn-primary mx-auto">
            <Plus className="w-4 h-4" />
            Registrar Artículo
          </button>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('code')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  Código/SKU {renderSortIcon('code')}
                </th>
                <th onClick={() => handleSort('name')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  Producto {renderSortIcon('name')}
                </th>
                <th onClick={() => handleSort('model')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  Modelo {renderSortIcon('model')}
                </th>
                <th onClick={() => handleSort('category')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  Categoría {renderSortIcon('category')}
                </th>
                <th onClick={() => handleSort('quantity')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  Cant. Stock {renderSortIcon('quantity')}
                </th>
                <th>Alerta Mín.</th>
                <th onClick={() => handleSort('purchase_price')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  P. Compra {renderSortIcon('purchase_price')}
                </th>
                <th onClick={() => handleSort('sale_price')} className="cursor-pointer select-none hover:text-foreground transition-colors">
                  P. Venta {renderSortIcon('sale_price')}
                </th>
                <th>Proveedor</th>
                <th className="w-24 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => {
                const isLowStock = item.quantity <= item.min_alert
                return (
                  <tr key={item.id} className="hover:bg-secondary/40 transition-colors">
                    <td className="font-mono text-xs font-semibold text-brand-400">{item.code}</td>
                    <td>
                      <div>
                        <p className="font-semibold text-foreground">{item.name}</p>
                        {item.description && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-xs">{item.description}</p>
                        )}
                      </div>
                    </td>
                    <td>
                      {item.model ? (
                        <span className="text-xs text-foreground font-medium">{item.model}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 italic">Ninguno</span>
                      )}
                    </td>
                    <td>
                      {item.category ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                          {item.category}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 italic">Ninguna</span>
                      )}
                    </td>
                    <td>
                      <span className={`inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full text-xs ${isLowStock
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                        {item.quantity}
                        {isLowStock && <AlertTriangle className="w-3 h-3" />}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">{item.min_alert}</td>
                    <td className="font-mono text-xs text-foreground font-semibold">${item.purchase_price.toFixed(2)}</td>
                    <td className="font-mono text-xs text-brand-300 font-bold">${item.sale_price.toFixed(2)}</td>
                    <td>
                      {item.supplier ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Truck className="w-3.5 h-3.5 text-brand-400/70" />
                          {item.supplier.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40 italic">Ninguno</span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleOpenForm(item)}
                          className="p-1.5 hover:bg-secondary rounded-lg transition-colors text-muted-foreground hover:text-brand-400"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(item.id)}
                          className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors text-muted-foreground hover:text-red-400"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <InventoryFormDialog
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        item={editingItem}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['inventory'] })}
      />

      <InventoryImportDialog
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['inventory'] })}
      />
    </div>
  )
}
