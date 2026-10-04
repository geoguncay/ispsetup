/**
 * FiberMapPage — Mapa de clientes por fibra óptica con los routers.
 */
import { ClientsMapPage } from '@/pages/ClientsMapPage'
import { MapFilters } from '@/pages/maps/MapFilters'
import { ClientMarker } from '@/pages/maps/ClientMarker'
import { RouterMarkers } from '@/pages/maps/RouterMarkers'
import { useClientsMap } from '@/hooks/useClientsMap'

export function FiberMapPage() {
  const map = useClientsMap('fiber')

  return (
    <ClientsMapPage
      title="Mapa de clientes · Fibra óptica"
      subtitle={`${map.clients.length} de ${map.total} clientes con ubicación`}
      filters={
        <MapFilters
          routers={map.routers}
          sites={map.sites}
          routerId={map.routerId}
          siteId={map.siteId}
          onRouterChange={map.setRouterId}
          onSiteChange={map.setSiteId}
        />
      }
      loading={map.isLoading}
      fetching={map.isFetching}
      onRefresh={() => map.refetch()}
      fitPoints={map.fitPoints}
      fitKey={map.filterKey}
      fitReady={!map.isPlaceholderData}
    >
      <RouterMarkers routers={map.visibleRouters} />
      {map.clients.map((c) => <ClientMarker key={c.id} client={c} />)}
    </ClientsMapPage>
  )
}
