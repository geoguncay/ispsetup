/**
 * DashboardPage — Panel principal con el resumen del sistema.
 *
 * Datos: /dashboard/summary (agregado), /dashboard/activity y /routers.
 * Las finanzas llegan solo para admin (`summary.finance === null` para el resto).
 */
import { RefreshCw, ShieldAlert } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { ActivityFeed } from './dashboard/ActivityFeed'
import { AlertsPanel } from './dashboard/AlertsPanel'
import { ClientsSection } from './dashboard/ClientsSection'
import { FinanceSection } from './dashboard/FinanceSection'
import { InfraSection } from './dashboard/InfraSection'
import { MapCard } from './dashboard/MapCard'
import { NetworkSection } from './dashboard/NetworkSection'
import { RevenueChart } from './dashboard/RevenueChart'
import {
  useDashboardActivity,
  useDashboardRouters,
  useDashboardSummary,
  useRevenueTrend,
} from './dashboard/useDashboardData'

export function DashboardPage() {
  const { user } = useAuthStore()
  const summary = useDashboardSummary()
  const activity = useDashboardActivity()
  const routers = useDashboardRouters()
  const isAdmin = user?.role === 'admin'
  const revenue = useRevenueTrend(isAdmin)

  const data = summary.data
  // Sin datos (cargando o con error) las tarjetas muestran "—" en vez de un 0 engañoso.
  const noData = !data

  return (
    <div className="w-full max-w-full min-w-0 space-y-6 overflow-x-hidden animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bienvenido, {user?.name?.split(' ')[0]} 👋</h1>
      </div>

      {summary.isError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-800/30 bg-red-900/20 p-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-foreground">
              No se pudo cargar el resumen del dashboard. Los valores mostrados pueden estar incompletos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => summary.refetch()}
            className="flex items-center gap-1.5 text-xs text-brand-400 hover:underline flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${summary.isFetching ? 'animate-spin' : ''}`} />
            Reintentar
          </button>
        </div>
      )}

      <InfraSection
        summary={data}
        loading={noData}
        routers={routers.data}
        routersLoading={routers.isPending}
        routersError={routers.isError}
      />

      <ClientsSection clients={data?.clients} loading={noData} />

      {data?.finance && <FinanceSection finance={data.finance} />}

      {isAdmin && (
        <RevenueChart points={revenue.data} loading={revenue.isPending} error={revenue.isError} />
      )}

      <NetworkSection network={data?.network} loading={noData} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <AlertsPanel alerts={data?.alerts} loading={summary.isPending} error={summary.isError} />
        <ActivityFeed items={activity.data} loading={activity.isPending} error={activity.isError} />
      </div>

      <MapCard points={data?.map_points} loading={summary.isPending} />
    </div>
  )
}
