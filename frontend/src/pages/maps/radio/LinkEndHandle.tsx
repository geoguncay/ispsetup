/** LinkEndHandle — Extremo arrastrable de un enlace seleccionado; al soltarlo sobre otro nodo reconecta el enlace. */
import L from 'leaflet'
import { Marker, useMap } from 'react-leaflet'

const handleIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:white;border:3px solid #ef4444;box-shadow:0 0 0 2px rgba(0,0,0,.25);cursor:grab"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export interface SnapNode {
  type: 'router' | 'ap' | 'client'
  id: string
  pos: [number, number]
}

interface Props {
  position: [number, number]
  /** Nodos a los que se puede conectar (se excluye el del otro extremo). */
  candidates: SnapNode[]
  onReconnect: (node: SnapNode) => void
}

const SNAP_PX = 36

export function LinkEndHandle({ position, candidates, onReconnect }: Props) {
  const map = useMap()

  return (
    <Marker
      position={position}
      icon={handleIcon}
      draggable
      zIndexOffset={2000}
      eventHandlers={{
        dragend: (e) => {
          const marker = e.target as L.Marker
          const drop = map.latLngToContainerPoint(marker.getLatLng())
          let best: SnapNode | null = null
          let bestDist = SNAP_PX
          for (const n of candidates) {
            const d = drop.distanceTo(map.latLngToContainerPoint(n.pos))
            if (d <= bestDist) {
              best = n
              bestDist = d
            }
          }
          // Vuelve al sitio original; si hubo reconexión, el re-render lo mueve al nuevo nodo.
          marker.setLatLng(position)
          if (best) onReconnect(best)
        },
      }}
    />
  )
}
