/**
 * RadioLinks — Líneas continuas del mapa de radio.
 *  - Enlaces guardados (PtP o AP→cliente/router): editables desde su popup.
 *  - Enlace automático router→cliente para los clientes que aún no tienen un enlace propio.
 */
import { Fragment } from 'react'
import L from 'leaflet'
import { Polyline, Popup } from 'react-leaflet'
import { LinkEndHandle, type SnapNode } from './LinkEndHandle'
import {
  type LinkKind, type MapAccessPoint, type MapClient, type MapLink, type MapRouter, type NodeType,
} from '../mapTypes'

interface Props {
  clients: MapClient[]
  routers: MapRouter[]
  accessPoints: MapAccessPoint[]
  links: MapLink[]
  editing: boolean
  selectedLinkId: string | null
  onSelectLink: (id: string) => void
  /** Convierte el enlace automático router→cliente en un enlace guardado (y editable). */
  onMaterialize: (routerId: string, clientId: string) => void
  onChangeKind: (id: string, kind: LinkKind) => void
  onReconnect: (id: string, end: 'source' | 'target', node: SnapNode) => void
  onDelete: (id: string) => void
}

type Pos = [number, number]
/** Distancia entre dos puntos: metros por debajo de 1000 m, kilómetros desde ahí. */
function formatDistance(a: Pos, b: Pos): string {
  const meters = L.latLng(a).distanceTo(L.latLng(b))
  return meters > 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

const LINK_COLOR = '#22c55e'
const HIT = { color: '#000', weight: 16, opacity: 0 }

export function RadioLinks({
  clients, routers, accessPoints, links, editing, selectedLinkId,
  onSelectLink, onMaterialize, onChangeKind, onReconnect, onDelete,
}: Props) {
  const nodes = new Map<string, { pos: Pos; name: string; client?: MapClient }>()
  routers.forEach(r => nodes.set(`router:${r.id}`, { pos: [r.latitude!, r.longitude!], name: r.name }))
  accessPoints.forEach(a => nodes.set(`ap:${a.id}`, { pos: [a.latitude, a.longitude], name: a.name }))
  clients.forEach(c => nodes.set(`client:${c.id}`, { pos: [c.latitude!, c.longitude!], name: c.full_name, client: c }))

  const key = (t: NodeType, id: string) => `${t}:${id}`
  const linkedClients = new Set<string>()
  links.forEach(l => {
    if (l.source_type === 'client') linkedClients.add(l.source_id)
    if (l.target_type === 'client') linkedClients.add(l.target_id)
  })
  const routerById = new Map(routers.map(r => [r.id, r]))

  return (
    <>
      {clients.filter(c => !linkedClients.has(c.id)).map((c) => {
        const router = c.router_id ? routerById.get(c.router_id) : undefined
        if (!router) return null
        const positions: Pos[] = [[router.latitude!, router.longitude!], [c.latitude!, c.longitude!]]
        return (
          <Fragment key={`auto-${c.id}`}>
            <Polyline
              positions={positions}
              pathOptions={{ color: LINK_COLOR, weight: 1.5, opacity: 0.7 }}
              interactive={false}
            />
            {editing && (
              <Polyline
                positions={positions}
                pathOptions={HIT}
                eventHandlers={{ click: () => onMaterialize(router.id, c.id) }}
              />
            )}
          </Fragment>
        )
      })}

      {links.map((l) => {
        const a = nodes.get(key(l.source_type, l.source_id))
        const b = nodes.get(key(l.target_type, l.target_id))
        if (!a || !b) return null
        const selected = editing && l.id === selectedLinkId
        const positions: Pos[] = [a.pos, b.pos]
        const snapTargets = (excludeKey: string): SnapNode[] =>
          [...nodes.entries()]
            .filter(([k]) => k !== excludeKey)
            .map(([k, n]) => {
              const [type, id] = k.split(':')
              return { type: type as NodeType, id, pos: n.pos }
            })
        return (
          <Fragment key={l.id}>
            <Polyline
              positions={positions}
              pathOptions={{ color: selected ? '#ef4444' : LINK_COLOR, weight: l.kind === 'ptp' ? 2.5 : 1.5, opacity: 0.9 }}
              interactive={false}
            />
            <Polyline
              positions={positions}
              pathOptions={HIT}
              eventHandlers={{ click: () => onSelectLink(l.id) }}
            >
              <Popup autoPan={false}>
                <div className="p-1 font-sans min-w-[180px] space-y-2">
                  {/* <p className="font-bold text-sm text-foreground m-0">{KIND_LABEL[l.kind]}</p> */}
                  <p className="text-xs font-semibold text-black m-0">{a.name} ↔ {b.name}</p>
                  <p className="text-xs m-0">
                    <span className="font-semibold text-black">Distancia:</span> {formatDistance(a.pos, b.pos)}
                  </p>
                  {editing && (
                    <>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <select
                          value={l.kind}
                          onChange={(e) => onChangeKind(l.id, e.target.value as LinkKind)}
                          className="input-field text-xs"
                        >
                          <option value="ptp">PtP</option>
                          <option value="ap">AP</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => onDelete(l.id)}
                          className="text-[10px] uppercase font-bold text-red-400 hover:text-red-300"
                        >
                          Eliminar
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground m-0">Arrastra los extremos rojos a otro nodo para moverlo.</p>
                    </>
                  )}
                </div>
              </Popup>
            </Polyline>
            {selected && (
              <>
                <LinkEndHandle
                  position={a.pos}
                  candidates={snapTargets(key(l.target_type, l.target_id))}
                  onReconnect={(n) => onReconnect(l.id, 'source', n)}
                />
                <LinkEndHandle
                  position={b.pos}
                  candidates={snapTargets(key(l.source_type, l.source_id))}
                  onReconnect={(n) => onReconnect(l.id, 'target', n)}
                />
              </>
            )}
          </Fragment>
        )
      })}
    </>
  )
}
