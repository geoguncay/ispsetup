import { Key, MapPin, Network, Shuffle } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { formatUptime } from '@/lib/utils'
import type { LoadBalancer } from '../types'

const markerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23f59e0b" width="38" height="38">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const lbIcon = L.icon({
  iconUrl: markerSvg,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -32],
})

interface InfoTabProps {
  lb: LoadBalancer
  isAdmin: boolean
  onEditLocation: () => void
}

export function InfoTab({ lb, isAdmin, onEditLocation }: InfoTabProps) {
  return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="glass-card p-5 space-y-4">
              <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
                <Key className="w-4.5 h-4.5" />
                <span>Información de Conexión</span>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="block text-xs text-muted-foreground">Dirección IP / Host</span>
                  <code className="text-sm font-mono text-foreground font-semibold">{lb.ip}:{lb.api_port}</code>
                </div>
                <div>
                  <span className="block text-xs text-muted-foreground">Usuario API</span>
                  <span className="text-sm text-foreground font-medium">{lb.api_username}</span>
                </div>
                {lb.ros_version && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Versión RouterOS</span>
                    <span className="text-sm text-foreground font-medium">{lb.ros_version}</span>
                  </div>
                )}
                {lb.uptime && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Tiempo Activo (Uptime)</span>
                    <span className="text-sm text-foreground font-medium">{formatUptime(lb.uptime)}</span>
                  </div>
                )}
                {lb.site_name && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Sitio</span>
                    <span className="text-sm text-foreground font-medium">{lb.site_name}</span>
                  </div>
                )}
                {lb.zerotier_node_id && (
                  <div>
                    <span className="block text-xs text-muted-foreground">ZeroTier</span>
                    <span className="text-sm text-foreground font-medium flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5" />
                      {lb.zerotier_node_id}
                    </span>
                  </div>
                )}
                {lb.notes && (
                  <div>
                    <span className="block text-xs text-muted-foreground">Notas</span>
                    <span className="text-sm text-foreground">{lb.notes}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <MapPin className="w-4.5 h-4.5" />
              <span>Coordenadas GPS</span>
            </div>
            {lb.latitude && lb.longitude ? (
              <div className="rounded-lg overflow-hidden h-[300px] border border-border/40 relative z-10">
                <MapContainer center={[lb.latitude, lb.longitude]} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={[lb.latitude, lb.longitude]} icon={lbIcon}>
                    <Popup>
                      <div className="p-1 text-foreground font-sans">
                        <h4 className="font-bold text-sm text-amber-500 flex items-center gap-1.5 m-0">
                          <Shuffle className="w-3.5 h-3.5" />
                          {lb.name}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1 mb-0 font-mono">{lb.ip}</p>
                      </div>
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-muted-foreground">Sin ubicación geográfica registrada.</p>
                {isAdmin && (
                  <button onClick={onEditLocation} className="text-xs text-brand-400 hover:text-brand-300 font-bold mt-2 hover:underline">
                    Marcar ubicación en el mapa
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
  )
}
