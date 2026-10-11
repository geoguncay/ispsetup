/**
 * RouterProfilePage — Ficha del router, listado de clientes asociados, ubicación geográfica y configuración del router.
 */
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, RefreshCw, Wifi, Edit2, Settings2,
  AlertCircle, Users, Network, Activity, ScrollText, ClipboardList,
} from 'lucide-react'
import api from '@/services/api'
import { RouterStatusBadge } from '@/pages/devices/shared/RouterStatusBadge'
import { RouterFormDialog } from '@/pages/devices/routers/RouterFormDialog'
import { RouterServicesDialog } from '@/pages/devices/routers/RouterServicesDialog'
import { RouterDeleteDialog, type RouterDeletionOptions } from '@/pages/devices/routers/RouterDeleteDialog'
import { useAuthStore } from '@/stores/authStore'
import type { Client, RouterProfileTab } from './types'
import { useRouterLiveTraffic } from './useRouterLiveTraffic'
import { RouterConnectionCard } from './RouterConnectionCard'
import { RouterLocationCard } from './RouterLocationCard'
import { RouterSettingsSummary } from './RouterSettingsSummary'
import { ImportAddressListDialog } from './ImportAddressListDialog'
import { StatsTab } from './tabs/StatsTab'
import { ClientsTab } from './tabs/ClientsTab'
import { QueuesTab } from './tabs/QueuesTab'
import { PppoeTab } from './tabs/PppoeTab'
import { LogsTab } from './tabs/LogsTab'
import { HistoryTab } from './tabs/HistoryTab'

export function RouterProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<RouterProfileTab>('stats')
  const [editOpen, setEditOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [importingOpen, setImportingOpen] = useState(false)

  // Consultar información del Router — se refresca automáticamente cada 15 s
  const anyModalOpen = editOpen || servicesOpen || importingOpen || confirmDeleteOpen
  const { data: router, isLoading: isLoadingRouter, isError: isErrorRouter, refetch: refetchRouter } = useQuery({
    queryKey: ['router', id],
    queryFn: async () => {
      const { data } = await api.get(`/routers/${id}`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 15_000,
  })

  // Ranking en vivo de clientes por consumo total
  const { liveClients, bridgeBytes } = useRouterLiveTraffic(id, router?.settings_configured, router?.traffic_accounting)

  // Todos los clientes del router (para estadísticas y mapa de cobertura)
  const { data: allClients = [] } = useQuery<Client[]>({
    queryKey: ['router-clients-all', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients`, {
        params: { router_id: id, limit: 1000 }
      })
      return data.items || []
    },
    enabled: router?.settings_configured === true,
  })

  // Mutación para eliminar router
  const deleteMutation = useMutation({
    mutationFn: async (options: RouterDeletionOptions) => {
      await api.delete(`/routers/${id}`, {
        params: {
          cleanup_routeros: options.cleanupRouterOs,
          delete_historical_data: options.deleteHistoricalData,
          confirmation: options.confirmation,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routers'] })
      navigate('/routers')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al eliminar el router'
      alert(msg)
    }
  })

  // Config Routers API (para saber si debug está activo)
  const { data: mikrotikConfig } = useQuery<{ mikrotik_debug: boolean }>({
    queryKey: ['router-api-config'],
    queryFn: async () => {
      const { data } = await api.get('/settings/router-api')
      return data
    },
  })
  const debugEnabled = mikrotikConfig?.mikrotik_debug ?? false

  if (isLoadingRouter) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando perfil del router...</span>
        </div>
      </div>
    )
  }

  if (isErrorRouter || !router) {
    return (
      <div className="glass-card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Error al cargar el router</h3>
        <p className="text-muted-foreground text-sm mb-6">
          El router solicitado no existe o ha sido desactivado permanentemente.
        </p>
        <button onClick={() => navigate('/routers')} className="btn-secondary mx-auto">
          <ArrowLeft className="w-4 h-4" />
          Volver a Routers
        </button>
      </div>
    )
  }

  const hasServiceConfig = router.settings_configured === true
  const usesPpp = router.security_mode === 'ppp_api'
  const usesSimpleQueues = router.speed_control_type === 'simple_queues'
    || router.speed_control_type === 'dhcp_lease_dynamic'

  const routerTabs: Array<{
    id: RouterProfileTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'stats', label: 'Estadísticas', icon: Network },
    { id: 'clients', label: 'Clientes Asociados', icon: Users },
    ...(usesSimpleQueues ? [{ id: 'queues' as const, label: 'Colas de Tráfico', icon: Activity }] : []),
    ...(usesPpp ? [{ id: 'pppoe' as const, label: 'Sesiones PPPoE', icon: Wifi }] : []),
    ...(debugEnabled ? [{ id: 'logs' as const, label: 'Logs ROS', icon: ScrollText }] : []),
    { id: 'historial', label: 'Historial ISP', icon: ClipboardList },
  ]
  const effectiveActiveTab = routerTabs.some((tab) => tab.id === activeTab) ? activeTab : 'stats'

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Breadcrumb & Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/routers')}
            className="w-10 h-10 rounded-lg bg-secondary/50 border border-border flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{router.name}</h1>
              <RouterStatusBadge status={router.status ?? 'unknown'} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                onClick={() => setServicesOpen(true)}
                className="btn-secondary"
              >
                <Settings2 className="w-4 h-4" />
                Ajustes
              </button>
              <button
                onClick={() => setEditOpen(true)}
                className="btn-primary"
              >
                <Edit2 className="w-4 h-4" />
                Editar
              </button>
            </>
          )}
        </div>
      </div>


      {/* ── Grid Principal ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Barra Lateral Izquierda - Detalles Rápidos */}
        <div className="space-y-6">
          <RouterConnectionCard router={router} />
          <RouterLocationCard
            router={router}
            allClients={allClients}
            isAdmin={isAdmin}
            onEditLocation={() => setEditOpen(true)}
          />
        </div>

        {/* Panel Principal - Tabs a la Derecha */}
        <div className="lg:col-span-2 space-y-6">
          {!hasServiceConfig ? (
            <div className="glass-card flex min-h-[400px] flex-col items-center justify-center p-12 text-center">
              <Settings2 className="mb-3 h-10 w-10 text-muted-foreground/30" />
              <h3 className="mb-1 text-sm font-semibold text-foreground">
                Configura los ajustes operativos del router
              </h3>
              <p className="mb-4 max-w-md text-xs leading-relaxed text-muted-foreground">
                Configura los ajustes operativos del router para optimizar su rendimiento y seguridad.
              </p>
              {isAdmin ? (
                <button type="button" onClick={() => setServicesOpen(true)} className="btn-primary text-sm">
                  <Settings2 className="h-4 w-4" />
                  Realizar ajustes
                </button>
              ) : (
                <p className="text-xs text-amber-400">Un administrador debe completar esta configuración.</p>
              )}
            </div>
          ) : (
          <>
          <RouterSettingsSummary
            router={router}
            isAdmin={isAdmin}
            onOpenSettings={() => setServicesOpen(true)}
          />

          {/* Navegación de Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Secciones del router">
            {routerTabs.map((tab) => {
              const Icon = tab.icon
              const isActive = effectiveActiveTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-all ${isActive
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {effectiveActiveTab === 'stats' && (
            <StatsTab allClients={allClients} liveClients={liveClients} bridgeBytes={bridgeBytes} />
          )}

          {effectiveActiveTab === 'clients' && (
            <ClientsTab
              routerId={id}
              router={router}
              isAdmin={isAdmin}
              onImportClick={() => setImportingOpen(true)}
            />
          )}

          {effectiveActiveTab === 'queues' && <QueuesTab routerId={id} router={router} />}

          {effectiveActiveTab === 'pppoe' && (
            <PppoeTab
              routerId={id}
              router={router}
              isAdmin={isAdmin}
              pollingPaused={anyModalOpen}
              onProfilesSynced={() => refetchRouter()}
            />
          )}

          {effectiveActiveTab === 'logs' && debugEnabled && (
            <LogsTab routerId={id} pollingPaused={anyModalOpen} />
          )}

          {effectiveActiveTab === 'historial' && (
            <HistoryTab routerId={id} pollingPaused={anyModalOpen} />
          )}
          </>
          )}
        </div>
      </div>

      {/* ── Dialog Seguridad, Tráfico y Velocidad ── */}
      {servicesOpen && (
        <RouterServicesDialog
          open={servicesOpen}
          onClose={() => setServicesOpen(false)}
          router={router}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['router', id] })
            queryClient.invalidateQueries({ queryKey: ['router-queues', id] })
            setActiveTab('stats')
          }}
        />
      )}

      {/* ── Dialog Crear/Editar Router ── */}
      {editOpen && (
        <RouterFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          router={router}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['router', id] })
            queryClient.invalidateQueries({ queryKey: ['routers'] })
            queryClient.invalidateQueries({ queryKey: ['router-queues', id] })
            setEditOpen(false)
          }}
          onDelete={() => {
            setEditOpen(false)
            setConfirmDeleteOpen(true)
          }}
        />
      )}

      <RouterDeleteDialog
        open={confirmDeleteOpen}
        routerName={router.name}
        pending={deleteMutation.isPending}
        error={(deleteMutation.error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={(options) => deleteMutation.mutate(options)}
      />


      <ImportAddressListDialog
        open={importingOpen}
        routerId={id}
        routerName={router.name}
        onClose={() => setImportingOpen(false)}
      />
    </div>
  )
}
