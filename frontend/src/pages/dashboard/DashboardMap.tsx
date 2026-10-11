/**
 * DashboardMap — Mini-mapa de solo lectura con routers, balanceadores, APs y estaciones.
 * Se carga de forma diferida (React.lazy) para no meter Leaflet en el bundle inicial.
 */
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { FitBounds } from '@/pages/maps/FitBounds'
import { DEFAULT_CENTER } from '@/pages/maps/mapTypes'
import { colorFor, isDown, KIND_LABEL, STATUS_LABEL } from './mapStyle'
import type { MapPoint } from './types'

export default function DashboardMap({ points }: { points: MapPoint[] }) {
  const coords: [number, number][] = points.map((p) => [p.latitude, p.longitude])
  const fitKey = points.map((p) => p.id).sort().join(',')

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={12}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%', zIndex: 10 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={coords} filterKey={fitKey} ready={points.length > 0} />
      {points.map((p) => (
        <CircleMarker
          key={`${p.kind}:${p.id}`}
          center={[p.latitude, p.longitude]}
          radius={p.kind === 'router' || p.kind === 'load_balancer' ? 9 : 7}
          pathOptions={{
            color: isDown(p) ? '#ef4444' : '#ffffff',
            weight: isDown(p) ? 3 : 2,
            fillColor: colorFor(p),
            fillOpacity: 0.95,
          }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <strong>{p.name}</strong>
            <br />
            {KIND_LABEL[p.kind]}
            {p.status ? ` · ${STATUS_LABEL[p.status] ?? p.status}` : ''}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
