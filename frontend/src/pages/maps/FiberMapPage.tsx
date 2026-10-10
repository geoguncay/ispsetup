/**
 * FiberMapPage — Mapa de clientes por fibra óptica con los routers.
 */
import { useMemo, useState } from 'react'
import { ClientsMapPage } from '@/pages/ClientsMapPage'
import { MapFilters } from '@/pages/maps/MapFilters'
import { ClientMarker } from '@/pages/maps/ClientMarker'
import { RouterMarkers } from '@/pages/maps/RouterMarkers'
import { MarkerCluster } from '@/pages/maps/MarkerCluster'
import { FocusController } from '@/pages/maps/FocusController'
import { LayerToggles } from '@/pages/maps/LayerToggles'
import { MapSearch, type SearchItem } from '@/pages/maps/MapSearch'
import { useClientsMap } from '@/hooks/useClientsMap'
import { useMapFocus } from '@/hooks/useMapFocus'

export function FiberMapPage() {
  const map = useClientsMap('fiber')
  const mapFocus = useMapFocus()
  const [visible, setVisible] = useState<Record<string, boolean>>({ routers: true, clients: true })

  const searchItems = useMemo<SearchItem[]>(() => [
    ...map.clients.map(c => ({ key: `client:${c.id}`, label: c.full_name, detail: [c.cedula, c.static_ip?.ip].filter(Boolean).join(' · '), kindLabel: 'Cliente', layer: 'clients' })),
    ...map.visibleRouters.map(r => ({ key: `router:${r.id}`, label: r.name, detail: '', kindLabel: 'Router', layer: 'routers' })),
  ], [map.clients, map.visibleRouters])

  const handleSearchSelect = (item: SearchItem) => {
    setVisible(v => ({ ...v, [item.layer]: true })) // si su capa estaba oculta, se muestra
    mapFocus.focus(item.key)
  }

  return (
    <ClientsMapPage
      title="Mapa de clientes · Fibra óptica"
      subtitle={`${map.clients.length} de ${map.total} clientes con ubicación`}
      filters={
        <>
          <MapFilters
            routers={map.routers}
            sites={map.sites}
            routerId={map.routerId}
            siteId={map.siteId}
            onRouterChange={map.setRouterId}
            onSiteChange={map.setSiteId}
          />
          <div className="glass-card p-3 flex flex-wrap items-center justify-between gap-3">
            <LayerToggles
              layers={[
                { id: 'routers', label: 'Routers', count: map.visibleRouters.length },
                { id: 'clients', label: 'Clientes', count: map.clients.length },
              ]}
              visible={visible}
              onToggle={(id) => setVisible(v => ({ ...v, [id]: !v[id] }))}
            />
            <MapSearch items={searchItems} onSelect={handleSearchSelect} />
          </div>
        </>
      }
      loading={map.isLoading}
      fetching={map.isFetching}
      onRefresh={() => map.refetch()}
      fitPoints={map.fitPoints}
      fitKey={map.filterKey}
      fitReady={!map.isPlaceholderData}
    >
      <MarkerCluster clusterRef={mapFocus.clusterRef}>
        <RouterMarkers routers={visible.routers ? map.visibleRouters : []} registerMarker={mapFocus.register} />
        {(visible.clients ? map.clients : []).map((c) => (
          <ClientMarker key={c.id} client={c} registerMarker={(m) => mapFocus.register(`client:${c.id}`, m)} />
        ))}
      </MarkerCluster>
      <FocusController target={mapFocus.target} markers={mapFocus.markers} clusterRef={mapFocus.clusterRef} openPopup />
    </ClientsMapPage>
  )
}
