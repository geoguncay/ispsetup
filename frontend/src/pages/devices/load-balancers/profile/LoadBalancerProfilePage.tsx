/**
 * LoadBalancerProfilePage — Ficha del balanceador: conexión y ubicación,
 * configuración de balanceo (PCC/Failover), scripts, puertos y tráfico en
 * vivo, historial de ejecuciones.
 */
import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Shuffle, Edit2, Network, Terminal, Activity,
  RefreshCw, AlertCircle, Wifi, History, Server,
} from 'lucide-react'
import api from '@/services/api'
import { LoadBalancerFormDialog } from '@/pages/devices/load-balancers/LoadBalancerFormDialog'
import { WanLinkFormDialog } from '@/pages/devices/load-balancers/WanLinkFormDialog'
import { RouterStatusBadge } from '@/pages/devices/shared/RouterStatusBadge'
import { useAuthStore } from '@/stores/authStore'
import type { LoadBalancer, LbInterface, LbProfileTab, ScriptRun } from './types'
import { useLoadBalancerBalancing } from './useLoadBalancerBalancing'
import { useLoadBalancerLiveTraffic } from './useLoadBalancerLiveTraffic'
import { DeleteLoadBalancerDialog } from './DeleteLoadBalancerDialog'
import { ScriptRunDetailDialog } from './ScriptRunDetailDialog'
import { InfoTab } from './tabs/InfoTab'
import { BalancingTab } from './tabs/BalancingTab'
import { ScriptTab } from './tabs/ScriptTab'
import { PortsTab } from './tabs/PortsTab'
import { TrafficTab } from './tabs/TrafficTab'
import { HistoryTab } from './tabs/HistoryTab'

export function LoadBalancerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<LbProfileTab>('info')
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<ScriptRun | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null)

  const anyModalOpen = editOpen || confirmDeleteOpen || !!selectedRun || linkModalOpen

  const { data: lb, isLoading: isLoadingLb, isError: isErrorLb } = useQuery<LoadBalancer>({
    queryKey: ['load-balancer', id],
    queryFn: async () => {
      const { data } = await api.get(`/load-balancers/${id}`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 15_000,
  })

  const { data: interfaces = [] } = useQuery<LbInterface[]>({
    queryKey: ['load-balancer-interfaces', id],
    queryFn: async () => {
      const { data } = await api.get(`/load-balancers/${id}/interfaces`)
      return data
    },
    refetchInterval: anyModalOpen ? false : 5_000,
  })

  const closeLinkModal = () => { setLinkModalOpen(false); setEditingLinkIndex(null) }
  const balancing = useLoadBalancerBalancing(id, lb, { editingIndex: editingLinkIndex, close: closeLinkModal })
  const traffic = useLoadBalancerLiveTraffic(id, activeTab === 'trafico')

  // ── Eliminar balanceador ──
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/load-balancers/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['load-balancers'] })
      navigate('/load-balancers')
    },
    onError: (err: any) => {
      setDeleteError(err?.response?.data?.detail || 'Error al eliminar el balanceador')
    },
  })

  if (isLoadingLb) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando perfil del balanceador...</span>
        </div>
      </div>
    )
  }

  if (isErrorLb || !lb) {
    return (
      <div className="glass-card p-12 text-center max-w-lg mx-auto mt-12">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Error al cargar el balanceador</h3>
        <p className="text-muted-foreground text-sm mb-6">
          El balanceador solicitado no existe o ha sido eliminado.
        </p>
        <button onClick={() => navigate('/load-balancers')} className="btn-secondary mx-auto">
          <ArrowLeft className="w-4 h-4" />
          Volver a Balanceadores
        </button>
      </div>
    )
  }

  const hasResponded = interfaces.length > 0
  const activePorts = interfaces.filter((i) => i.running && !i.disabled).length

  const tabs: Array<{ id: LbProfileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'info', label: 'Información', icon: Server },
    { id: 'balanceo', label: 'Balanceo', icon: Shuffle },
    { id: 'script', label: 'Script', icon: Terminal },
    { id: 'puertos', label: 'Puertos', icon: Network },
    { id: 'trafico', label: 'Tráfico en vivo', icon: Activity },
    { id: 'historial', label: 'Historial', icon: History },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Breadcrumb & Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/load-balancers')}
            className="w-10 h-10 rounded-lg bg-secondary/50 border border-border flex items-center justify-center hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{lb.name}</h1>
              <RouterStatusBadge status={lb.status ?? 'unknown'} size="sm" />
              {hasResponded && (
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-secondary/60 text-muted-foreground border border-border/40 flex items-center gap-1">
                  <Wifi className="w-3 h-3" /> {activePorts}/{interfaces.length} puertos activos
                </span>
              )}
            </div>
            {lb.hw_model && <p className="text-xs text-muted-foreground mt-0.5">{lb.hw_model}</p>}
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => setEditOpen(true)} className="btn-primary">
              <Edit2 className="w-4 h-4" />
              Editar
            </button>
          </div>
        )}
      </div>

      {/* ── Navegación de Tabs ── */}
      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Secciones del balanceador">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
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

      {activeTab === 'info' && <InfoTab lb={lb} isAdmin={isAdmin} onEditLocation={() => setEditOpen(true)} />}

      {activeTab === 'balanceo' && (
        <BalancingTab
          isAdmin={isAdmin}
          algorithm={balancing.algorithm}
          wanLinks={balancing.wanLinks}
          interfaces={interfaces}
          pendingApply={balancing.pendingApply}
          applyResult={balancing.applyResult}
          isApplying={balancing.isApplying}
          onAlgorithmChange={balancing.handleAlgorithmChange}
          onAddLink={() => { setEditingLinkIndex(null); setLinkModalOpen(true) }}
          onEditLink={(index) => { setEditingLinkIndex(index); setLinkModalOpen(true) }}
          onRemoveLink={balancing.handleRemoveLink}
          onApply={balancing.handleApplyTemplate}
        />
      )}

      {activeTab === 'script' && <ScriptTab lb={lb} />}

      {activeTab === 'puertos' && <PortsTab interfaces={interfaces} />}

      {activeTab === 'trafico' && (
        <TrafficTab
          interfaces={interfaces}
          selectedChartInterface={traffic.selectedChartInterface}
          onChartInterfaceChange={traffic.setSelectedChartInterface}
          liveSeries={traffic.liveSeries}
        />
      )}

      {activeTab === 'historial' && (
        <HistoryTab loadBalancerId={id} pollingPaused={anyModalOpen} onSelectRun={setSelectedRun} />
      )}

      {/* ── Dialog de edición ── */}
      <LoadBalancerFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        loadBalancer={lb}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['load-balancer', id] })
          queryClient.invalidateQueries({ queryKey: ['load-balancers'] })
          setEditOpen(false)
        }}
        onDelete={() => { setEditOpen(false); setConfirmDeleteOpen(true) }}
      />

      {/* ── Dialog de enlace WAN (agregar/editar) ── */}
      <WanLinkFormDialog
        open={linkModalOpen}
        onClose={closeLinkModal}
        algorithm={balancing.algorithm}
        link={editingLinkIndex !== null ? balancing.wanLinks[editingLinkIndex] ?? null : null}
        availableInterfaces={interfaces.map((i) => i.name)}
        isSaving={balancing.isSaving}
        onSave={balancing.handleLinkModalSave}
      />

      <DeleteLoadBalancerDialog
        open={confirmDeleteOpen}
        error={deleteError}
        isPending={deleteMutation.isPending}
        onCancel={() => { setConfirmDeleteOpen(false); setDeleteError(null) }}
        onConfirm={() => deleteMutation.mutate()}
      />

      <ScriptRunDetailDialog run={selectedRun} onClose={() => setSelectedRun(null)} />
    </div>
  )
}
