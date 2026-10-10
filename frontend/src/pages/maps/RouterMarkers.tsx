/** RouterMarkers — Marcadores de los routers que tienen coordenadas. */
import type L from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import { flipPopupHandlers } from './flipPopup'
import { routerMarkerIcon, type MapRouter } from './mapTypes'

interface Props {
  routers: MapRouter[]
  /** Si se define, el clic llama a esta función (modo edición) en lugar de abrir el popup. */
  onSelect?: (router: MapRouter) => void
  /** Modo edición: el marcador se arrastra; `revert` lo devuelve a su sitio si falla el guardado. */
  draggable?: boolean
  onMove?: (router: MapRouter, lat: number, lng: number, revert: () => void) => void
  /** Registra el marcador (o null al desmontar) para poder localizarlo desde el buscador. */
  registerMarker?: (key: string, marker: L.Marker | null) => void
}

export function RouterMarkers({ routers, onSelect, draggable = false, onMove, registerMarker }: Props) {
  return (
    <>
      {routers.map((r) => (
        <Marker key={r.id} position={[r.latitude!, r.longitude!]} icon={routerMarkerIcon}
          ref={(m) => registerMarker?.(`router:${r.id}`, m)}
          draggable={draggable}
          eventHandlers={{
            ...(onSelect ? { click: () => onSelect(r) } : flipPopupHandlers),
            dragend: (e) => {
              const marker = e.target as L.Marker
              const { lat, lng } = marker.getLatLng()
              onMove?.(r, lat, lng, () => marker.setLatLng([r.latitude!, r.longitude!]))
            },
          }}
        >
          {!onSelect && <Popup autoPan={false}>
            <div className="p-1 font-sans min-w-[160px]">
              <p className="font-bold text-sm text-foreground m-0">{r.name}</p>
              <p className="text-[11px] text-muted-foreground mt-1 m-0">Router</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5 m-0">
                {r.latitude!.toFixed(5)}, {r.longitude!.toFixed(5)}
              </p>
            </div>
          </Popup>}
        </Marker>
      ))}
    </>
  )
}
