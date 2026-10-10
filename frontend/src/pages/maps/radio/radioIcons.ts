/** Iconos propios del mapa de radio: casa del cliente (según estado) y AP. */
import L from 'leaflet'
import {type ClientStatus } from '../mapTypes'

const homeCache = new Map<ClientStatus, L.DivIcon>()

/** Cliente: círculo del color de su estado con una casa. */
export function clientHomeIcon(status: ClientStatus): L.DivIcon {
  let icon = homeCache.get(status)
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
        <svg fill="#278c03" height="200px" width="200px" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-51.2 -51.2 614.40 614.40" xmlns:xlink="http://www.w3.org/1999/xlink" enable-background="new 0 0 512 512" stroke="#278c03" stroke-width="0.00512"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#CCCCCC" stroke-width="1.024"></g><g id="SVGRepo_iconCarrier"> <g> <g> <path d="m449.3,297.7h-172.9v-82.3c0-11.3-9.1-20.4-20.4-20.4s-20.4,9.1-20.4,20.4v82.3h-172.9c-28.5,0-51.7,23.2-51.7,51.7v99.9c0,28.5 23.2,51.7 51.7,51.7h386.7c28.5,0 51.7-23.2 51.7-51.7v-99.9c-0.1-28.5-23.3-51.7-51.8-51.7zm10.9,151.6c0,6-4.9,10.8-10.8,10.8h-386.7c-6,0-10.8-4.9-10.8-10.8v-99.9c0-6 4.9-10.8 10.8-10.8h386.7c6,0 10.8,4.9 10.8,10.8v99.9z"></path> <path d="m156.2,93.1c55-55 144.5-55 199.6,0 4,4 9.2,6 14.4,6 5.2,0 10.5-2 14.4-6 8-8 8-20.9 0-28.9-70.9-70.9-186.3-70.9-257.3,0-8,8-8,20.9 0,28.9 8,8 20.9,8 28.9,0z"></path> <path d="m194.3,131.1c-8,8-8,20.9 0,28.9 4,4 9.2,6 14.4,6 5.2,0 10.4-2 14.4-6 18.1-18.1 47.6-18.1 65.7,0 8,8 20.9,8 28.9,0 8-8 8-20.9 0-28.9-34-34-89.4-34-123.4,0z"></path> <path d="m269.8,378.9h-27.6c-11.3,0-20.4,9.1-20.4,20.4s9.1,20.4 20.4,20.4h27.6c11.3,0 20.4-9.1 20.4-20.4s-9.1-20.4-20.4-20.4z"></path> </g> </g> </g></svg>
      </div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -15],
    })
    homeCache.set(status, icon)
  }
  return icon
}

const radioIconCache = new Map<string, L.DivIcon>()

/** Atributo del contenedor interno del icono; su `transform` se ajusta con `setRadioIconRotation`. */
export const ROTATABLE_ATTR = 'data-rotatable'

/** Gira el icono de un radio sin recrearlo (recrearlo en pleno arrastre interrumpiría el movimiento). */
export function setRadioIconRotation(markerEl: HTMLElement | undefined, deg: number) {
  const inner = markerEl?.querySelector<HTMLElement>(`[${ROTATABLE_ATTR}]`)
  if (inner) inner.style.transform = `rotate(${deg}deg)`
}

/** Círculo de color con ondas wifi; las ondas apuntan al norte hasta que se aplica la rotación. */
function radioIcon(color: string): L.DivIcon {
  const cacheKey = color
  let icon = radioIconCache.get(cacheKey)
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div ${ROTATABLE_ATTR} style="width:36px;height:36px;">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
          <circle cx="18" cy="18" r="17" fill="${color}" stroke="white" stroke-width="2"/>
          <g stroke="white" stroke-width="2" stroke-linecap="round" fill="none">
            <path d="M10.5 14.5a10.5 10.5 0 0 1 15 0M13.3 17.6a6.4 6.4 0 0 1 9.4 0"/>
          </g>
          <circle cx="18" cy="21.5" r="2" fill="white"/>
        </svg>
      </div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18],
    })
    radioIconCache.set(cacheKey, icon)
  }
  return icon
}

/** Punto de acceso (AP): naranja. En un PtMP gira a gusto; en un PtP mira hacia su estación. */
export const apIcon = radioIcon('#f97316')

/** Antena estación de un PtP: turquesa; mira hacia su AP. */
export const stationIcon = radioIcon('#0d9488')
