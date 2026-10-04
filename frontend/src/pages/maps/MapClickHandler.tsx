/** MapClickHandler — Reporta el clic sobre el mapa (solo cuando `enabled`). */
import { useMapEvents } from 'react-leaflet'

export function MapClickHandler({ enabled, onClick }: { enabled: boolean; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      if (enabled) onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}
