import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, X, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import api from '@/services/api'

interface ImportAddressListDialogProps {
  open: boolean
  routerId: string | undefined
  routerName: string
  onClose: () => void
}

/** Importa clientes desde una address-list del router. */
export function ImportAddressListDialog({ open: importingOpen, routerId: id, routerName, onClose }: ImportAddressListDialogProps) {
  const queryClient = useQueryClient()
  const [selectedListName, setSelectedListName] = useState('clientes')
  const [customListName, setCustomListName] = useState('')
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null)

  // Limpiar resultado de la importación cuando el modal se abre o se cierra
  useEffect(() => {
    if (!importingOpen) {
      setImportResult(null)
    }
  }, [importingOpen])

  const { data: addressLists = [], isLoading: isLoadingLists } = useQuery<string[]>({
    queryKey: ['address-lists', id],
    queryFn: async () => {
      const { data } = await api.get(`/routers/${id}/address-lists`)
      return data
    },
    enabled: importingOpen,
  })

  const importMutation = useMutation({
    mutationFn: async (listName: string) => {
      const { data } = await api.post(`/routers/${id}/import-clients`, null, {
        params: { list_name: listName }
      })
      return data
    },
    onSuccess: (data: any) => {
      setImportResult({
        success: true,
        message: `Importación exitosa. Se importaron ${data.imported_count} nuevos clientes.`
      })
      setSelectedListName('clientes')
      setCustomListName('')
      queryClient.invalidateQueries({ queryKey: ['router-clients-paginated', id] })
      queryClient.invalidateQueries({ queryKey: ['router-clients-all', id] })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al importar clientes desde el router.'
      setImportResult({
        success: false,
        message: msg
      })
    }
  })

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const listName = selectedListName === 'custom' ? customListName.trim() : selectedListName
    if (!listName) return
    importMutation.mutate(listName)
  }

  const setImportingOpen = (value: boolean) => {
    if (!value) onClose()
  }

  if (!importingOpen) return null

  return (
      createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md mx-4 animate-fade-in border border-border/50">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Download className="w-5 h-5 text-brand-400" />
                Importar desde Address-list
              </h2>
              <button
                type="button"
                onClick={() => setImportingOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {importResult?.success ? (
              <div className="p-6 text-center space-y-4 font-sans">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto text-emerald-400 animate-fade-in">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-semibold text-foreground">¡Importación Exitosa!</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed font-sans">
                    {importResult.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportingOpen(false)}
                  className="btn-primary w-full justify-center mt-2"
                >
                  Entendido
                </button>
              </div>
            ) : (
              <form onSubmit={handleImportSubmit} className="p-5 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Selecciona una lista de direcciones del router <strong>{routerName}</strong>. Se importarán todas sus IPs y se registrarán como nuevos clientes en el sistema y en la lista <strong>clientes</strong> del router.
                </p>

                {importResult && !importResult.success && (
                  <div className="rounded-lg p-3.5 flex items-start gap-3 text-xs leading-relaxed bg-destructive/10 border border-destructive/30 text-destructive font-sans">
                    <XCircle className="w-4.5 h-4.5 text-destructive flex-shrink-0 mt-0.5" />
                    <div className="flex-grow">
                      <p className="font-semibold text-foreground">Fallo en la importación</p>
                      <p className="mt-0.5 text-muted-foreground">{importResult.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setImportResult(null)}
                      className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Seleccionar Address-list *
                  </label>
                  {isLoadingLists ? (
                    <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando listas del router...
                    </div>
                  ) : (
                    <select
                      value={selectedListName}
                      onChange={(e) => {
                        setSelectedListName(e.target.value)
                        if (e.target.value !== 'custom') {
                          setCustomListName('')
                        }
                      }}
                      className="input-field cursor-pointer"
                    >
                      <option value="clientes">clientes</option>
                      {addressLists
                        .filter((l: string) => l !== 'clientes')
                        .map((listName: string) => (
                          <option key={listName} value={listName}>
                            {listName}
                          </option>
                        ))}
                      <option value="custom">-- Escribir name personalizado --</option>
                    </select>
                  )}
                </div>

                {selectedListName === 'custom' && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Nombre de la lista personalizado *
                    </label>
                    <input
                      type="text"
                      value={customListName}
                      onChange={(e) => setCustomListName(e.target.value)}
                      placeholder="Ej: IPs_Nuevas, WAN_List, etc."
                      required
                      className="input-field font-sans"
                    />
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setImportingOpen(false)}
                    className="btn-secondary flex-1 justify-center"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={importMutation.isPending || (selectedListName === 'custom' && !customListName.trim())}
                    className="btn-primary flex-1 justify-center"
                  >
                    {importMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {importMutation.isPending ? 'Importando...' : 'Importar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )
  )
}
