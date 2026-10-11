/** Colores, etiquetas y leyenda del mini-mapa (sin dependencias de Leaflet, para no romper el lazy-load). */
import type { MapPoint } from './types'

export const KIND_LABEL: Record<MapPoint['kind'], string> = {
  router: 'Router',
  load_balancer: 'Balanceador',
  ap: 'Punto de acceso',
  station: 'Estación',
}

export const STATUS_LABEL: Record<string, string> = {
  online: 'En línea',
  offline: 'Fuera de línea',
  tunnel_down: 'Túnel caído',
  degraded: 'Degradado',
  unknown: 'Desconocido',
}

export const ROUTER_STATUS_COLOR: Record<string, string> = {
  online: '#10b981',
  offline: '#ef4444',
  tunnel_down: '#f59e0b',
  degraded: '#f59e0b',
  unknown: '#94a3b8',
}

export function colorFor(p: MapPoint): string {
  if (p.kind === 'router') return ROUTER_STATUS_COLOR[p.status ?? 'unknown'] ?? ROUTER_STATUS_COLOR.unknown
  if (p.kind === 'load_balancer') return '#8b5cf6'
  if (p.kind === 'ap') return '#0ea5e9'
  return '#d946ef'
}

export function isDown(p: MapPoint): boolean {
  return p.kind === 'load_balancer' && (p.status === 'offline' || p.status === 'tunnel_down')
}

export const MAP_LEGEND = [
  { color: ROUTER_STATUS_COLOR.online, label: 'Router en línea' },
  { color: ROUTER_STATUS_COLOR.offline, label: 'Router con problemas' },
  { color: '#8b5cf6', label: 'Balanceador' },
  { color: '#0ea5e9', label: 'Punto de acceso' },
  { color: '#d946ef', label: 'Estación' },
]
