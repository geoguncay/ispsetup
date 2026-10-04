/** Iconos propios del mapa de radio: casa del cliente (según estado) y AP. */
import L from 'leaflet'
import { STATUS_HEX, type ClientStatus } from '../mapTypes'

const homeCache = new Map<ClientStatus, L.DivIcon>()

/** Cliente: círculo del color de su estado con una casa. */
export function clientHomeIcon(status: ClientStatus): L.DivIcon {
  let icon = homeCache.get(status)
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="30" height="30">
          <circle cx="15" cy="15" r="14" fill="${STATUS_HEX[status]}" stroke="white" stroke-width="2"/>
          <path d="M8.5 15.5L15 9.5l6.5 6M10.5 14.5V21h9v-6.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -15],
    })
    homeCache.set(status, icon)
  }
  return icon
}

/** Punto de acceso (AP): rombo naranja con ondas de señal. */
export const apIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
      <rect x="5" y="5" width="26" height="26" rx="6" fill="#f97316" stroke="white" stroke-width="2" transform="rotate(45 18 18)"/>
      <g stroke="white" stroke-width="2" stroke-linecap="round" fill="none">
        <path d="M11.5 15a9 9 0 0 1 13 0M14 17.8a5.4 5.4 0 0 1 8 0"/>
      </g>
      <circle cx="18" cy="21.5" r="1.8" fill="white"/>
    </svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})

/** Antena estación (extremo cliente de un PtP): rombo turquesa con un punto receptor. */
export const stationIcon = L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
      <rect x="5" y="5" width="26" height="26" rx="6" fill="#0d9488" stroke="white" stroke-width="2" transform="rotate(45 18 18)"/>
      <g stroke="white" stroke-width="2" stroke-linecap="round" fill="none">
        <path d="M12 21a7.5 7.5 0 0 0 12 0M18 12v6"/>
      </g>
      <circle cx="18" cy="11.5" r="1.8" fill="white"/>
    </svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
})
