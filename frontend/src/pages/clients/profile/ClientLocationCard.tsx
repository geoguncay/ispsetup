import { MapPin } from 'lucide-react'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Icono personalizado SVG de Leaflet para evitar problemas de rutas de Vite
const markerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%232563eb" width="36" height="36">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const customMarkerIcon = L.icon({
  iconUrl: markerSvg,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
})

/** Mapa con la geolocalización GPS del cliente. */
export function ClientLocationCard({ client }: { client: any }) {
  return (
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Geolocalización GPS</span>
              <MapPin className="w-4 h-4 text-brand-400" />
            </div>

            {client.latitude && client.longitude ? (
              <div className="space-y-3">
                <div className="rounded-lg overflow-hidden border border-border h-48">
                  <MapContainer
                    center={[client.latitude, client.longitude]}
                    zoom={14}
                    scrollWheelZoom={false}
                    dragging={false}
                    zoomControl={false}
                    style={{ height: '100%', width: '100%', zIndex: 10 }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[client.latitude, client.longitude]} icon={customMarkerIcon} />
                  </MapContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground text-center">
                  <div className="bg-secondary/40 p-1.5 rounded">Lat: {client.latitude}</div>
                  <div className="bg-secondary/40 p-1.5 rounded">Lng: {client.longitude}</div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground border border-dashed border-border rounded-lg">
                <MapPin className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-xs">No hay coordenadas GPS guardadas para este cliente.</p>
              </div>
            )}
          </div>
  )
}
