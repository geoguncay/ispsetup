/**
 * RadioMapPage — Mapa de radioenlace: routers, APs, clientes y enlaces editables (AP / PtP).
 */
import { useEffect, useState } from 'react'
import { ClientsMapPage } from '@/pages/ClientsMapPage'
import { MapFilters } from '@/pages/maps/MapFilters'
import { ClientMarker } from '@/pages/maps/ClientMarker'
import { RouterMarkers } from '@/pages/maps/RouterMarkers'
import { MapClickHandler } from '@/pages/maps/MapClickHandler'
import { RadioLinks } from '@/pages/maps/radio/RadioLinks'
import { AccessPointMarker } from '@/pages/maps/radio/AccessPointMarker'
import { RadioToolbar, type RadioMode } from '@/pages/maps/radio/RadioToolbar'
import { clientHomeIcon } from '@/pages/maps/radio/radioIcons'
import type { NodeType } from '@/pages/maps/mapTypes'
import { CircleMarker } from 'react-leaflet'
import { ApFormModal, PtpFormModal, type ApFormValues, type PtpFormValues } from '@/pages/maps/radio/RadioNodeModals'
import { useClientsMap } from '@/hooks/useClientsMap'
import { useRadioTopology } from '@/hooks/useRadioTopology'

type Pos = { lat: number; lng: number }

const HINTS: Record<RadioMode, string> = {
  view: 'Haz clic en un elemento para ver su información.',
  edit: 'Clic en un enlace para seleccionarlo: arrastra sus extremos rojos a otro nodo para moverlo, o pulsa Suprimir para eliminarlo. Arrastra los AP para moverlos.',
  'add-ap': 'Haz clic en el mapa para ubicar el AP del enlace PtMP.',
  ptp: 'Haz clic en el mapa para ubicar el AP del enlace y luego otro clic para ubicar la antena estación.',
}

export function RadioMapPage() {
  const map = useClientsMap('radio')
  const topo = useRadioTopology()
  const [mode, setMode] = useState<RadioMode>('view')
  const [apPos, setApPos] = useState<Pos | null>(null)      // AP nuevo (modal de AP o 1.er clic del PtP)
  const [stationPos, setStationPos] = useState<Pos | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)

  const cancelPlacement = () => {
    setApPos(null)
    setStationPos(null)
    setFormError(null)
  }

  const changeMode = (m: RadioMode) => {
    setMode(m)
    cancelPlacement()
    setSelectedLinkId(null)
  }

  const alertError = (err: any) => window.alert(err?.response?.data?.detail ?? 'No se pudo completar la operación')

  const deleteLink = (id: string) => {
    topo.deleteLink.mutate(id)
    setSelectedLinkId(null)
  }

  // Suprimir elimina el enlace seleccionado (modo edición).
  useEffect(() => {
    if (mode !== 'edit' || !selectedLinkId) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if ((e.key === 'Delete' || e.key === 'Backspace') && tag !== 'INPUT' && tag !== 'SELECT') {
        topo.deleteLink.mutate(selectedLinkId)
        setSelectedLinkId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selectedLinkId])

  const handleMaterialize = (routerId: string, clientId: string) =>
    topo.createLink.mutate(
      { kind: 'ap', source_type: 'router', source_id: routerId, target_type: 'client', target_id: clientId },
      { onSuccess: (l) => setSelectedLinkId(l.id), onError: alertError },
    )

  const handleReconnect = (id: string, end: 'source' | 'target', node: { type: NodeType; id: string }) =>
    topo.updateLink.mutate(
      end === 'source'
        ? { id, source_type: node.type, source_id: node.id }
        : { id, target_type: node.type, target_id: node.id },
      { onError: alertError },
    )

  const handleMapClick = (lat: number, lng: number) => {
    if (mode === 'add-ap') setApPos({ lat, lng })
    else if (mode === 'ptp') {
      if (!apPos) setApPos({ lat, lng })
      else if (!stationPos) setStationPos({ lat, lng })
    } else if (mode === 'edit') setSelectedLinkId(null)
  }

  const handleSaveAp = (v: ApFormValues) => {
    if (!apPos) return
    topo.createAp.mutate(
      { name: v.name, latitude: apPos.lat, longitude: apPos.lng, ip: v.ip, frequency_mhz: v.frequency_mhz, connect_to: v.connect_to },
      { onSuccess: cancelPlacement, onError: (e: any) => setFormError(e?.response?.data?.detail ?? 'No se pudo guardar el AP') },
    )
  }

  const handleSavePtp = (v: PtpFormValues) => {
    if (!apPos || !stationPos) return
    topo.createPtp.mutate(
      {
        ap: { ...v.ap, latitude: apPos.lat, longitude: apPos.lng },
        station: { ...v.station, latitude: stationPos.lat, longitude: stationPos.lng },
        frequency_mhz: v.frequency_mhz,
        connect_to: v.connect_to,
      },
      { onSuccess: cancelPlacement, onError: (e: any) => setFormError(e?.response?.data?.detail ?? 'No se pudo guardar el PtP') },
    )
  }

  const hint = mode === 'ptp' && apPos && !stationPos ? 'AP ubicado. Haz clic para ubicar la antena estación.' : HINTS[mode]

  return (
    <ClientsMapPage
      title="Mapa de clientes · Radioenlace"
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
          <RadioToolbar mode={mode} onModeChange={changeMode} hint={hint} />
          {mode === 'add-ap' && apPos && (
            <ApFormModal
              pos={apPos}
              routers={map.routers}
              accessPoints={topo.accessPoints}
              saving={topo.createAp.isPending}
              error={formError}
              onClose={cancelPlacement}
              onSave={handleSaveAp}
            />
          )}
          {mode === 'ptp' && apPos && stationPos && (
            <PtpFormModal
              apPos={apPos}
              stationPos={stationPos}
              routers={map.routers}
              accessPoints={topo.accessPoints}
              saving={topo.createPtp.isPending}
              error={formError}
              onClose={cancelPlacement}
              onSave={handleSavePtp}
            />
          )}
        </>
      }
      loading={map.isLoading}
      fetching={map.isFetching}
      onRefresh={() => map.refetch()}
      fitPoints={[...map.fitPoints, ...topo.accessPoints.map(a => [a.latitude, a.longitude] as [number, number])]}
      fitKey={map.filterKey}
      fitReady={!map.isPlaceholderData}
    >
      <MapClickHandler enabled={mode !== 'view'} onClick={handleMapClick} />
      <RadioLinks
        clients={map.clients}
        routers={map.visibleRouters}
        accessPoints={topo.accessPoints}
        links={topo.links}
        editing={mode === 'edit'}
        selectedLinkId={selectedLinkId}
        onSelectLink={setSelectedLinkId}
        onMaterialize={handleMaterialize}
        onChangeKind={(id, kind) => topo.updateLink.mutate({ id, kind })}
        onReconnect={handleReconnect}
        onDelete={deleteLink}
      />
      <RouterMarkers routers={map.visibleRouters} />
      {mode === 'ptp' && apPos && (
        <CircleMarker center={[apPos.lat, apPos.lng]} radius={9} pathOptions={{ color: '#f97316', fillOpacity: 0.7 }} />
      )}
      {mode === 'ptp' && stationPos && (
        <CircleMarker center={[stationPos.lat, stationPos.lng]} radius={9} pathOptions={{ color: '#0d9488', fillOpacity: 0.7 }} />
      )}
      {topo.accessPoints.map((ap) => (
        <AccessPointMarker
          key={ap.id}
          ap={ap}
          editing={mode === 'edit'}
          onMove={(latitude, longitude) => topo.updateAp.mutate({ id: ap.id, latitude, longitude })}
          onRename={(name) => topo.updateAp.mutate({ id: ap.id, name })}
          onDelete={() => topo.deleteAp.mutate(ap.id)}
        />
      ))}
      {map.clients.map((c) => (
        <ClientMarker key={c.id} client={c} getIcon={clientHomeIcon} />
      ))}
    </ClientsMapPage>
  )
}
