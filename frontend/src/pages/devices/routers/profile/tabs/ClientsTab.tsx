import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Download, Users } from 'lucide-react'
import api from '@/services/api'
import type { Client } from '../types'

const CLIENTS_PER_PAGE = 10

interface ClientsTabProps {
  routerId: string | undefined
  router: any
  isAdmin: boolean
  onImportClick: () => void
}

/** Clientes asociados al router, con búsqueda y paginación. */
export function ClientsTab({ routerId: id, router, isAdmin, onImportClick }: ClientsTabProps) {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')
  const [clientsPage, setClientsPage] = useState(1)
  const clientsLimit = CLIENTS_PER_PAGE

  const { data: paginatedClientsData = { items: [], total: 0 } } = useQuery({
    queryKey: ['router-clients-paginated', id, clientsPage, searchTerm],
    queryFn: async () => {
      const params: any = {
        router_id: id,
        skip: (clientsPage - 1) * clientsLimit,
        limit: clientsLimit
      }
      if (searchTerm.trim()) {
        params.search = searchTerm
      }
      const { data } = await api.get(`/clients`, { params })
      return data
    },
    enabled: router?.settings_configured === true,
  })

  const totalPages = Math.ceil((paginatedClientsData.total || 0) / clientsLimit)

  return (
            <div className="space-y-4">
              {/* Barra de Búsqueda y Acciones */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-grow max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setClientsPage(1) }}
                    placeholder="Buscar cliente por name, cédula o IP..."
                    className="input-field pl-10"
                  />
                </div>
                {isAdmin && (
                  <div>
                    {router.status === 'online' ? (
                      <button
                        onClick={onImportClick}
                        className="btn-secondary text-brand-400 hover:text-brand-300 text-xs py-2 px-3 flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Importar desde Address-list
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground bg-secondary/40 py-2 px-3 rounded-lg border border-border/20" title="El router debe estar En línea para permitir la importación automática de clientes.">
                        Router fuera de línea (sin importación)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {paginatedClientsData.items.length === 0 ? (
                <div className="glass-card p-8 text-center text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
                  No se encontraron clientes asignados a este router que coincidan con la búsqueda.
                </div>
              ) : (
                <>
                  <div className="glass-card overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th className="hidden sm:table-cell">Cédula</th>
                          <th>IP</th>
                          <th>Plan</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedClientsData.items.map((client: Client) => (
                          <tr
                            key={client.id}
                            onClick={() => navigate(`/clients/${client.id}`)}
                            className="hover:bg-secondary/40 cursor-pointer transition-colors"
                          >
                            <td>
                              <div className="font-semibold text-sm text-foreground">{client.full_name}</div>
                              <div className="text-xs text-muted-foreground capitalize sm:hidden">
                                {client.access_method === 'static' ? 'IP Estática' : 'PPPoE'}
                              </div>
                            </td>
                            <td className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                              {client.cedula}
                            </td>
                            <td>
                              <code className="text-xs font-mono text-muted-foreground bg-secondary/60 px-1.5 py-0.5 rounded">
                                {client.static_ip?.ip ? client.static_ip.ip : 'PPPoE'}
                              </code>
                            </td>
                            <td className="text-xs text-brand-400 font-medium">
                              {client.plan_activo?.name ? client.plan_activo.name : 'Sin plan'}
                            </td>
                            <td>
                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${client.active
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}>
                                {client.active ? 'Activo' : 'Suspendido'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Controles de Paginación */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between p-1 mt-4">
                      <span className="text-xs text-muted-foreground">
                        Mostrando {paginatedClientsData.items.length} de {paginatedClientsData.total} clientes
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setClientsPage((prev) => Math.max(prev - 1, 1))}
                          disabled={clientsPage === 1}
                          className="btn-secondary py-1.5 px-3 text-xs"
                        >
                          Anterior
                        </button>
                        <span className="text-xs text-foreground font-medium font-mono px-2">
                          Página {clientsPage} de {totalPages}
                        </span>
                        <button
                          onClick={() => setClientsPage((prev) => Math.min(prev + 1, totalPages))}
                          disabled={clientsPage === totalPages}
                          className="btn-secondary py-1.5 px-3 text-xs"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
  )
}
