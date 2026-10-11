/**
 * ClientProfilePage — Ficha del cliente, historial de planes, acciones de red y mapa de ubicación GPS.
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, AlertCircle, Edit2, Trash2 } from 'lucide-react'
import api from '@/services/api'
import { ToastContainer } from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import { ClientFormDialog } from '@/pages/clients/ClientFormDialog'
import { InvoiceCreateDialog } from '@/pages/billing/invoices/InvoiceCreateDialog'
import type { ClientProfileTab } from './types'
import { useClientSuspension } from './useClientSuspension'
import { useClientStateChangeToasts } from './useClientStateChangeToasts'
import { useClientPppoeSession } from './useClientPppoeSession'
import { ClientTitleBar } from './ClientTitleBar'
import { ClientInfoGroups } from './ClientInfoGroups'
import { ClientStatusBanners } from './ClientStatusBanners'
import { ClientPppoeSessionCard } from './ClientPppoeSessionCard'
import { ClientPlanCard } from './ClientPlanCard'
import { ClientLocationCard } from './ClientLocationCard'
import { ChangePlanDialog } from './ChangePlanDialog'
import { CreateTicketDialog } from './CreateTicketDialog'
import { DeleteClientDialog } from './DeleteClientDialog'
import { DisconnectSessionDialog } from './DisconnectSessionDialog'
import { SuspensionDialogs } from './SuspensionDialogs'
import { TrafficTab } from './tabs/TrafficTab'
import { BillingTab } from './tabs/BillingTab'
import { PlansTab } from './tabs/PlansTab'
import { SuspensionsTab } from './tabs/SuspensionsTab'
import { TicketsTab } from './tabs/TicketsTab'
import { DocumentsTab } from './tabs/DocumentsTab'

export function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toasts, addToast, removeToast } = useToast()

  const [activeTab, setActiveTab] = useState<ClientProfileTab>('traffic')
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [createTicketOpen, setCreateTicketOpen] = useState(false)
  const [manualInvoiceOpen, setManualInvoiceOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [confirmDisconnectSessionOpen, setConfirmDisconnectSessionOpen] = useState(false)

  const suspension = useClientSuspension(id, addToast)

  const anyModalOpen = editOpen || confirmDeleteOpen || changePlanOpen || suspension.anyDialogOpen ||
    confirmDisconnectSessionOpen || manualInvoiceOpen || createTicketOpen

  // Consultar Cliente
  // refetchInterval: detecta suspensiones/reactivaciones programadas que el worker
  // de Celery aplica en segundo plano, sin que el usuario tenga que recargar la página.
  const { data: client, isLoading, isError, refetch } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 30_000,
  })

  useClientStateChangeToasts(client, addToast, suspension.suppressAutoToastRef)
  const { activeSession, disconnectSessionMutation } = useClientPppoeSession(client, anyModalOpen, addToast)

  // Eliminar cliente
  const deleteClientMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clients', {
        state: { toast: { type: 'success', message: `Cliente "${client?.full_name}" eliminado correctamente.` } }
      })
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.detail || 'Error al eliminar el cliente de la base de datos')
    }
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando ficha del cliente...</span>
        </div>
      </div>
    )
  }

  if (isError || !client) {
    return (
      <div className="glass-card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Error al cargar el cliente</h3>
        <p className="text-muted-foreground text-sm mb-6">
          El cliente que intentas consultar no existe o no tienes permisos de acceso.
        </p>
        <button onClick={() => navigate('/clients')} className="btn-primary mx-auto">
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>
    )
  }

  const { activeSuspension } = suspension

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Botón Volver y Acciones */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/clients')}
          className="btn-secondary text-xs py-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          {/* Botón Editar Cliente */}
          <button
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-secondary hover:bg-secondary/80 border border-border/80 text-foreground transition-all duration-200"
          >
            <Edit2 className="w-3.5 h-3.5 text-brand-400" />
            <span>Editar Cliente</span>
          </button>

          {/* Botón Eliminar Cliente */}
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 transition-all duration-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Eliminar Cliente</span>
          </button>
        </div>
      </div>

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Columna Izquierda: Información del Cliente */}
        <div className="lg:col-span-2 space-y-6">

          {/* Card Detalle */}
          <div className="glass-card p-6 relative">
            <div className="space-y-4">
              <ClientTitleBar
                client={client}
                allowDeferral={suspension.allowDeferral}
                isSuspending={suspension.suspendClientMutation.isPending}
                isReactivating={suspension.reactivateClientMutation.isPending}
                onDefer={() => suspension.setDeferOpen(true)}
                onSuspend={() => suspension.setSuspendOpen(true)}
                onDeferReactivation={() => suspension.setDeferReactivationOpen(true)}
                onReactivate={() => suspension.reactivateClientMutation.mutate()}
              />

              <ClientInfoGroups client={client} />

              <ClientStatusBanners
                client={client}
                activeSuspension={activeSuspension}
                isReactivating={suspension.reactivateClientMutation.isPending}
                cancelDeferPending={suspension.cancelDeferMutation.isPending}
                cancelReactivationPending={suspension.cancelScheduledReactivationMutation.isPending}
                onCancelDefer={() => suspension.setConfirmCancelDeferOpen(true)}
                onCancelReactivation={() => suspension.setConfirmCancelReactivationOpen(true)}
                onReactivate={() => suspension.reactivateClientMutation.mutate()}
              />

              {/* Estado de la Sesión en tiempo real (solo si es pppoe) */}
              {client.access_method === 'pppoe' && (
                <ClientPppoeSessionCard
                  activeSession={activeSession}
                  isDisconnecting={disconnectSessionMutation.isPending}
                  onDisconnect={() => setConfirmDisconnectSessionOpen(true)}
                />
              )}
            </div>
          </div>

          {/* Tabs Historiales */}
          <div className="glass-card overflow-hidden">
            {/* Header Tabs */}
            <div className="flex border-b border-border bg-secondary/20">
              {[
                { id: 'traffic', label: 'Estadísticas' },
                { id: 'payments', label: 'Facturación' },
                { id: 'plans', label: 'Servicios' },
                { id: 'suspensions', label: 'Suspensiones' },
                { id: 'tickets', label: 'Tickets' },
                { id: 'documents', label: 'Documentos' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-5 py-3 text-sm font-medium transition-all duration-150 ${activeTab === tab.id
                    ? 'border-b-2 border-brand-500 text-brand-400 bg-secondary/10'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content Tabs */}
            <div className="p-5">
              {activeTab === 'traffic' && <TrafficTab clientId={id} routerId={client.router_id} />}

              {activeTab === 'payments' && (
                <BillingTab
                  clientId={id}
                  client={client}
                  addToast={addToast}
                  onNewInvoice={() => setManualInvoiceOpen(true)}
                  onClientChanged={() => refetch()}
                />
              )}

              {activeTab === 'plans' && <PlansTab clientId={id} client={client} />}

              {activeTab === 'suspensions' && (
                <SuspensionsTab
                  suspensionHistory={suspension.suspensionHistory}
                  isLoading={suspension.isLoadingSuspensions}
                />
              )}

              {activeTab === 'tickets' && (
                <TicketsTab clientId={id} onCreateTicket={() => setCreateTicketOpen(true)} />
              )}

              {activeTab === 'documents' && <DocumentsTab />}

            </div>
          </div>
        </div>

        {/* Columna Derecha: Plan Activo y Ubicación GPS */}
        <div className="space-y-6">
          <ClientPlanCard
            clientId={id}
            client={client}
            addToast={addToast}
            onChangePlan={() => setChangePlanOpen(true)}
          />
          <ClientLocationCard client={client} />
        </div>
      </div>

      {changePlanOpen && (
        <ChangePlanDialog
          clientId={id}
          client={client}
          addToast={addToast}
          onClose={() => setChangePlanOpen(false)}
        />
      )}

      {createTicketOpen && (
        <CreateTicketDialog
          clientId={id}
          addToast={addToast}
          onClose={() => setCreateTicketOpen(false)}
        />
      )}

      {/* Dialog para Editar Cliente */}
      <ClientFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        client={client}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['client', id] })
          queryClient.invalidateQueries({ queryKey: ['clients'] })
          queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
          setEditOpen(false)
        }}
      />

      {confirmDeleteOpen && (
        <DeleteClientDialog
          clientName={client.full_name}
          error={deleteError}
          isPending={deleteClientMutation.isPending}
          onCancel={() => { setConfirmDeleteOpen(false); setDeleteError(null) }}
          onConfirm={() => deleteClientMutation.mutate()}
        />
      )}

      <SuspensionDialogs client={client} suspension={suspension} />

      {confirmDisconnectSessionOpen && (
        <DisconnectSessionDialog
          username={client.pppoe_secret?.ppp_username}
          isPending={disconnectSessionMutation.isPending}
          onCancel={() => setConfirmDisconnectSessionOpen(false)}
          onConfirm={() => {
            disconnectSessionMutation.mutate(undefined, { onSuccess: () => setConfirmDisconnectSessionOpen(false) })
          }}
        />
      )}

      {/* Modal Crear Factura Manual */}
      <InvoiceCreateDialog
        isOpen={manualInvoiceOpen}
        onClose={() => setManualInvoiceOpen(false)}
        preselectedClientId={client.id}
        preselectedClientName={client.full_name}
        preselectedClientCedula={client.cedula}
        onSuccess={() => {
          refetch()
          queryClient.invalidateQueries({ queryKey: ['client-invoices', id] })
        }}
      />

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}
