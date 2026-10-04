/** MapFilters — Filtros de router y sitio para los mapas. */
import type { MapRouter, MapSite } from './mapTypes'

interface Props {
  routers: MapRouter[]
  sites: MapSite[]
  routerId: string
  siteId: string
  onRouterChange: (id: string) => void
  onSiteChange: (id: string) => void
}

export function MapFilters({ routers, sites, routerId, siteId, onRouterChange, onSiteChange }: Props) {
  return (
    <div className="glass-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <select value={routerId} onChange={(e) => onRouterChange(e.target.value)} className="input-field cursor-pointer">
        <option value="">Todos los routers</option>
        {routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <select value={siteId} onChange={(e) => onSiteChange(e.target.value)} className="input-field cursor-pointer">
        <option value="">Todos los sitios</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  )
}
