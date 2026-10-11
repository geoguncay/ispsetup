/**
 * RadioMapPage — Mapa de radioenlace: routers, APs, clientes y enlaces editables (AP / PtP).
 */
import { useEffect, useMemo, useState } from 'react'
import { ClientsMapPage } from '@/pages/clients/ClientsMapPage'
import { MapFilters } from '@/pages/maps/MapFilters'
import { ClientMarker } from '@/pages/maps/ClientMarker'
import { RouterMarkers } from '@/pages/maps/RouterMarkers'
import { MapClickHandler } from '@/pages/maps/MapClickHandler'
import { RadioLinks } from '@/pages/maps/radio/RadioLinks'
import { AccessPointMarker } from '@/pages/maps/radio/AccessPointMarker'
import { RadioToolbar, type RadioMode } from '@/pages/maps/radio/RadioToolbar'
import { clientHomeIcon } from '@/pages/maps/radio/radioIcons'
import type { MapAccessPoint, MapLink, NodeRef, NodeType } from '@/pages/maps/mapTypes'
import { CircleMarker } from 'react-leaflet'
import { MarkerCluster } from '@/pages/maps/MarkerCluster'
import { FocusController } from '@/pages/maps/FocusController'
import { LayerToggles } from '@/pages/maps/LayerToggles'
import { MapSearch, type SearchItem } from '@/pages/maps/MapSearch'
import { useMapFocus } from '@/hooks/useMapFocus'
import { ApFormModal, PtpFormModal, type ApFormValues, type PtpFormValues } from '@/pages/maps/radio/RadioNodeModals'
import { useClientsMap } from '@/hooks/useClientsMap'
import { useRadioTopology } from '@/hooks/useRadioTopology'
import { bearingDeg } from '@/pages/maps/radio/geo'
import { useMoveLocation } from '@/hooks/useMoveLocation'

type Pos = { lat: number; lng: number }
/** Elemento abierto en el modal de edición: un PtMP (un AP) o un PtP (AP + estación). */
type EditTarget = { kind: 'ptmp'; apId: string } | { kind: 'ptp'; apId: string; stationId: string }

const HINTS: Record<RadioMode, string> = {
  view: 'Haz clic en un elemento para ver su información.',
  edit: 'Clic en un PtP o PtMP para editarlo o eliminarlo. Clic en un enlace para seleccionarlo: arrastra sus extremos rojos a otro nodo para moverlo. Arrastra routers, clientes y APs para cambiar su ubicación.',
  'add-ap': 'Haz clic en el mapa para ubicar el AP del enlace PtMP.',
  ptp: 'Haz clic en el mapa para ubicar el AP del enlace y luego otro clic para ubicar la antena estación.',
}

export function RadioMapPage() {
  const map = useClientsMap('radio')
  const topo = useRadioTopology()
  const moveLocation = useMoveLocation()
  const mapFocus = useMapFocus()
  const [visible, setVisible] = useState<Record<string, boolean>>({ routers: true, radios: true, clients: true })
  const [mode, setMode] = useState<RadioMode>('view')
  const [apPos, setApPos] = useState<Pos | null>(null)      // AP nuevo (modal de AP o 1.er clic del PtP)
  const [stationPos, setStationPos] = useState<Pos | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  // Posición en vivo de los radios que se están arrastrando (hasta que el servidor confirma).
  const [livePos, setLivePos] = useState<Record<string, [number, number]>>({})
  const radios = useMemo(
    () => topo.accessPoints.map(a => (livePos[a.id] ? { ...a, latitude: livePos[a.id][0], longitude: livePos[a.id][1] } : a)),
    [topo.accessPoints, livePos],
  )

  /** Un radio de PtP mira hacia su pareja (y gira si cualquiera se mueve); un PtMP usa su orientación guardada. */
  const rotationOf = (ap: MapAccessPoint): number => {
    const link = topo.links.find(l => l.kind === 'ptp' && l.source_type === 'ap' && l.target_type === 'ap' && (l.source_id === ap.id || l.target_id === ap.id))
    if (link) {
      const peer = radios.find(a => a.id === (link.source_id === ap.id ? link.target_id : link.source_id))
      if (peer) return bearingDeg([ap.latitude, ap.longitude], [peer.latitude, peer.longitude])
    }
    return ap.rotation_deg ?? 0
  }

  const shownRouters = visible.routers ? map.visibleRouters : []
  const shownRadios = visible.radios ? radios : []
  const shownClients = visible.clients ? map.clients : []

  const searchItems = useMemo<SearchItem[]>(() => [
    ...map.clients.map(c => ({ key: `client:${c.id}`, label: c.full_name, detail: [c.cedula, c.static_ip?.ip].filter(Boolean).join(' · '), kindLabel: 'Cliente', layer: 'clients' })),
    ...map.visibleRouters.map(r => ({ key: `router:${r.id}`, label: r.name, detail: '', kindLabel: 'Router', layer: 'routers' })),
    ...topo.accessPoints.map(a => ({ key: `ap:${a.id}`, label: a.name, detail: a.ip ?? '', kindLabel: a.role === 'station' ? 'Antena estación' : 'AP', layer: 'radios' })),
  ], [map.clients, map.visibleRouters, topo.accessPoints])

  const handleSearchSelect = (item: SearchItem) => {
    setVisible(v => ({ ...v, [item.layer]: true })) // si su capa estaba oculta, se muestra
    mapFocus.focus(item.key)
  }

  const cancelPlacement = () => {
    setApPos(null)
    setStationPos(null)
    setFormError(null)
  }

  const changeMode = (m: RadioMode) => {
    setMode(m)
    cancelPlacement()
    setSelectedLinkId(null)
    setEditTarget(null)
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

  // Un PtP es un enlace 'ptp' entre dos radios; el AP es el de rol 'ap' (o el origen del enlace).
  const ptpTarget = (link: MapLink): EditTarget | null => {
    if (link.kind !== 'ptp' || link.source_type !== 'ap' || link.target_type !== 'ap') return null
    const src = topo.accessPoints.find(a => a.id === link.source_id)
    const dst = topo.accessPoints.find(a => a.id === link.target_id)
    if (!src || !dst) return null
    const [ap, station] = dst.role === 'ap' && src.role === 'station' ? [dst, src] : [src, dst]
    return { kind: 'ptp', apId: ap.id, stationId: station.id }
  }

  const editAp = (ap: MapAccessPoint) => {
    const link = topo.links.find(l => l.kind === 'ptp' && ((l.source_type === 'ap' && l.source_id === ap.id) || (l.target_type === 'ap' && l.target_id === ap.id)))
    setEditTarget((link && ptpTarget(link)) || { kind: 'ptmp', apId: ap.id })
  }

  const editAp1 = editTarget && topo.accessPoints.find(a => a.id === editTarget.apId)
  const editStation = editTarget?.kind === 'ptp' ? topo.accessPoints.find(a => a.id === editTarget.stationId) : undefined

  // Conexión de un AP: enlace 'ap' cuyo destino es ese AP (el origen es el router/AP del que cuelga).
  const connectLinkOf = (apId: string) =>
    topo.links.find(l => l.kind === 'ap' && l.target_type === 'ap' && l.target_id === apId)
  const connectValueOf = (apId: string) => {
    const l = connectLinkOf(apId)
    return l ? `${l.source_type}:${l.source_id}` : ''
  }

  const applyConnection = async (apId: string, desired: NodeRef | null) => {
    const cur = connectLinkOf(apId)
    if (cur && !desired) await topo.deleteLink.mutateAsync(cur.id)
    else if (cur && desired && (cur.source_type !== desired.type || cur.source_id !== desired.id)) {
      await topo.updateLink.mutateAsync({ id: cur.id, source_type: desired.type, source_id: desired.id })
    } else if (!cur && desired) {
      await topo.createLink.mutateAsync({ kind: 'ap', source_type: desired.type, source_id: desired.id, target_type: 'ap', target_id: apId })
    }
  }

  const closeEdit = () => {
    setEditTarget(null)
    setFormError(null)
  }

  const handleSaveEdit = async (ap: MapAccessPoint, v: { name: string; ip: string | null; frequency_mhz: number | null; channel_width_mhz: number | null; rotation_deg?: number; connect_to: NodeRef | null }, station?: { name: string; ip: string | null }) => {
    try {
      await applyConnection(ap.id, v.connect_to)
      await topo.updateAp.mutateAsync({ id: ap.id, name: v.name, ip: v.ip, frequency_mhz: v.frequency_mhz, channel_width_mhz: v.channel_width_mhz, rotation_deg: v.rotation_deg })
      if (station && editStation) {
        await topo.updateAp.mutateAsync({ id: editStation.id, name: station.name, ip: station.ip, frequency_mhz: v.frequency_mhz, channel_width_mhz: v.channel_width_mhz })
      }
      closeEdit()
    } catch (e: any) {
      setFormError(e?.response?.data?.detail ?? 'No se pudieron guardar los cambios')
    }
  }

  const handleDeleteEdit = async () => {
    if (!editAp1) return
    const what = editTarget?.kind === 'ptp' ? `el enlace PtP "${editAp1.name}"` : `el PtMP "${editAp1.name}"`
    if (!window.confirm(`¿Eliminar ${what} y sus enlaces?`)) return
    try {
      await topo.deleteAp.mutateAsync(editAp1.id)
      if (editStation) await topo.deleteAp.mutateAsync(editStation.id)
      closeEdit()
    } catch (e: any) {
      setFormError(e?.response?.data?.detail ?? 'No se pudo eliminar')
    }
  }

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

  const moveNode = (type: 'client' | 'router', id: string, latitude: number, longitude: number, revert: () => void) =>
    moveLocation.mutate({ type, id, latitude, longitude }, {
      onError: (err: any) => {
        revert()
        alertError(err)
      },
    })

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
      { name: v.name, latitude: apPos.lat, longitude: apPos.lng, ip: v.ip, frequency_mhz: v.frequency_mhz, channel_width_mhz: v.channel_width_mhz, rotation_deg: v.rotation_deg, connect_to: v.connect_to },
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
        channel_width_mhz: v.channel_width_mhz,
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
          <div className="glass-card p-3 flex flex-wrap items-center justify-between gap-3">
            <LayerToggles
              layers={[
                { id: 'routers', label: 'Routers', count: map.visibleRouters.length },
                { id: 'radios', label: 'APs y PtP', count: topo.accessPoints.length },
                { id: 'clients', label: 'Clientes', count: map.clients.length },
              ]}
              visible={visible}
              onToggle={(id) => setVisible(v => ({ ...v, [id]: !v[id] }))}
            />
            <MapSearch items={searchItems} onSelect={handleSearchSelect} />
          </div>
          <RadioToolbar
            mode={mode}
            onModeChange={changeMode}
            hint={hint}
            onDeleteLink={mode === 'edit' && selectedLinkId ? () => deleteLink(selectedLinkId) : undefined}
          />
          {mode === 'edit' && editTarget?.kind === 'ptmp' && editAp1 && (
            <ApFormModal
              key={editAp1.id}
              pos={{ lat: editAp1.latitude, lng: editAp1.longitude }}
              initial={editAp1}
              initialConnect={connectValueOf(editAp1.id)}
              excludeApIds={[editAp1.id]}
              routers={map.routers}
              accessPoints={topo.accessPoints}
              saving={topo.updateAp.isPending || topo.deleteAp.isPending}
              error={formError}
              onClose={closeEdit}
              onSave={(v) => handleSaveEdit(editAp1, v)}
              onDelete={handleDeleteEdit}
            />
          )}
          {mode === 'edit' && editTarget?.kind === 'ptp' && editAp1 && editStation && (
            <PtpFormModal
              key={editAp1.id}
              apPos={{ lat: editAp1.latitude, lng: editAp1.longitude }}
              stationPos={{ lat: editStation.latitude, lng: editStation.longitude }}
              initial={{ ap: editAp1, station: editStation }}
              initialConnect={connectValueOf(editAp1.id)}
              excludeApIds={[editAp1.id, editStation.id]}
              routers={map.routers}
              accessPoints={topo.accessPoints}
              saving={topo.updateAp.isPending || topo.deleteAp.isPending}
              error={formError}
              onClose={closeEdit}
              onSave={(v) => handleSaveEdit(editAp1, { name: v.ap.name, ip: v.ap.ip, frequency_mhz: v.frequency_mhz, channel_width_mhz: v.channel_width_mhz, connect_to: v.connect_to }, v.station)}
              onDelete={handleDeleteEdit}
            />
          )}
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
        clients={shownClients}
        routers={shownRouters}
        accessPoints={shownRadios}
        links={topo.links}
        editing={mode === 'edit'}
        selectedLinkId={selectedLinkId}
        onSelectLink={setSelectedLinkId}
        onMaterialize={handleMaterialize}
        onEditPtp={(l) => { const t = ptpTarget(l); if (t) setEditTarget(t) }}
        onReconnect={handleReconnect}
      />
      {mode === 'ptp' && apPos && (
        <CircleMarker center={[apPos.lat, apPos.lng]} radius={9} pathOptions={{ color: '#f97316', fillOpacity: 0.7 }} />
      )}
      {mode === 'ptp' && stationPos && (
        <CircleMarker center={[stationPos.lat, stationPos.lng]} radius={9} pathOptions={{ color: '#0d9488', fillOpacity: 0.7 }} />
      )}
      <MarkerCluster clusterRef={mapFocus.clusterRef}>
      <RouterMarkers
        routers={shownRouters}
        draggable={mode === 'edit'}
        registerMarker={mapFocus.register}
        onMove={(r, lat, lng, revert) => moveNode('router', r.id, lat, lng, revert)}
      />
      {shownRadios.map((ap) => (
        <AccessPointMarker
          registerMarker={(m) => mapFocus.register(`ap:${ap.id}`, m)}
          key={ap.id}
          ap={ap}
          editing={mode === 'edit'}
          rotation={rotationOf(ap)}
          onDrag={(lat, lng) => setLivePos(p => ({ ...p, [ap.id]: [lat, lng] }))}
          onMove={(latitude, longitude) => topo.updateAp.mutate(
            { id: ap.id, latitude, longitude },
            { onSettled: () => setLivePos(p => Object.fromEntries(Object.entries(p).filter(([k]) => k !== ap.id))) },
          )}
          onEdit={() => editAp(ap)}
        />
      ))}
      {shownClients.map((c) => (
        <ClientMarker
          key={c.id}
          client={c}
          registerMarker={(m) => mapFocus.register(`client:${c.id}`, m)}
          getIcon={clientHomeIcon}
          draggable={mode === 'edit'}
          onMove={(lat, lng, revert) => moveNode('client', c.id, lat, lng, revert)}
        />
      ))}
      </MarkerCluster>
      <FocusController target={mapFocus.target} markers={mapFocus.markers} clusterRef={mapFocus.clusterRef} openPopup={mode === 'view'} />
    </ClientsMapPage>
  )
}
