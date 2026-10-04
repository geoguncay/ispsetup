/** Tipos y utilidades compartidas por los mapas de clientes. */
import L from 'leaflet'

export interface MapClient {
  id: string
  full_name: string
  cedula: string
  phone: string
  latitude: number | null
  longitude: number | null
  router_id?: string | null
  active: boolean
  scheduled_suspension?: string | null
  scheduled_reactivation?: string | null
  plan_activo: { id: string; name: string } | null
  static_ip?: { ip: string } | null
}

export interface MapRouter {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
}

export interface MapSite {
  id: string
  name: string
}

export interface MapAccessPoint {
  id: string
  name: string
  latitude: number
  longitude: number
  /** 'ap' = punto de acceso; 'station' = antena estación de un PtP. */
  role: 'ap' | 'station'
  ip?: string | null
  frequency_mhz?: number | null
}

export interface NodeRef {
  type: NodeType
  id: string
}

export type NodeType = 'router' | 'ap' | 'client'
export type LinkKind = 'ptp' | 'ap'

export interface MapLink {
  id: string
  kind: LinkKind
  source_type: NodeType
  source_id: string
  target_type: NodeType
  target_id: string
}

export type ClientStatus = 'active' | 'scheduled_suspension' | 'scheduled_reactivation' | 'suspended'

export const DEFAULT_CENTER: [number, number] = [-0.180653, -78.467834]

export function getClientStatus(client: MapClient): ClientStatus {
  if (client.active) return client.scheduled_suspension ? 'scheduled_suspension' : 'active'
  return client.scheduled_reactivation ? 'scheduled_reactivation' : 'suspended'
}

export const STATUS_HEX: Record<ClientStatus, string> = {
  active: '#10b981',
  scheduled_suspension: '#0ea5e9',
  scheduled_reactivation: '#a855f7',
  suspended: '#f59e0b',
}

const STATUS_COLOR: Record<ClientStatus, string> = {
  active: '%2310b981',
  scheduled_suspension: '%230ea5e9',
  scheduled_reactivation: '%23a855f7',
  suspended: '%23f59e0b',
}

export const STATUS_LABEL: Record<ClientStatus, string> = {
  active: 'Activo',
  scheduled_suspension: 'Aplazado',
  scheduled_reactivation: 'Reactivación prog.',
  suspended: 'Suspendido',
}

export const STATUS_BADGE: Record<ClientStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25',
  scheduled_suspension: 'bg-sky-500/10 text-sky-400 border border-sky-500/25',
  scheduled_reactivation: 'bg-purple-500/10 text-purple-400 border border-purple-500/25',
  suspended: 'bg-amber-500/10 text-amber-400 border border-amber-500/25',
}

const iconCache = new Map<ClientStatus, L.Icon>()

/** Pin del cliente coloreado según su estado (cacheado por estado). */
export function clientIcon(status: ClientStatus): L.Icon {
  let icon = iconCache.get(status)
  if (!icon) {
    icon = L.icon({
      iconUrl: `data:image/svg+xml;utf8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${STATUS_COLOR[status]}" width="36" height="36">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      `)}`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -30],
    })
    iconCache.set(status, icon)
  }
  return icon
}

/** Icono de router: caja con luces y dos antenas, sobre un círculo azul. */
export const routerMarkerIcon = L.divIcon({
  className: '',
  html: `<div style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">
      <circle cx="20" cy="20" r="19" fill="#2563eb" stroke="white" stroke-width="2"/>
      <g stroke="white" stroke-width="2" stroke-linecap="round" fill="none">
        <path d="M13 17l-2-5M27 17l2-5"/>
        <rect x="9" y="17" width="22" height="10" rx="2.5" fill="#1d4ed8"/>
      </g>
      <circle cx="14" cy="22" r="1.4" fill="#86efac"/>
      <circle cx="19" cy="22" r="1.4" fill="white"/>
      <circle cx="24" cy="22" r="1.4" fill="white"/>
    </svg>
  </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -22],
})
