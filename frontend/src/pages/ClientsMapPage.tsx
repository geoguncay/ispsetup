/**
 * Cada medio (radio, fibra) aporta sus filtros y capas como hijos.
 */
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { FitBounds } from '@/pages/maps/FitBounds'
import { DEFAULT_CENTER } from '@/pages/maps/mapTypes'

interface Props {
  title: string
  subtitle: string
  filters: ReactNode
  loading: boolean
  fetching: boolean
  onRefresh: () => void
  fitPoints: [number, number][]
  fitKey: string
  fitReady: boolean
  children: ReactNode
}

export function ClientsMapPage({
  filters, loading, fitPoints, fitKey, fitReady, children,
}: Props) {
  return (
    <div className="space-y-6 animate-fade-in">

      {filters}

      {loading ? (
        <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Cargando mapa...</span>
        </div>
      ) : (
        <div className="glass-card overflow-hidden h-[calc(100vh-18rem)] min-h-[420px] border border-border/40 relative">
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={12}
            scrollWheelZoom={true}
            style={{ height: '100%', width: '100%', zIndex: 10 }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={fitPoints} filterKey={fitKey} ready={fitReady} />
            {children}
          </MapContainer>
        </div>
      )}
    </div>
  )
}
