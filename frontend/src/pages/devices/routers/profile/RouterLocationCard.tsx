import { useNavigate } from 'react-router-dom'
import { MapPin, Server } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Client } from './types'

// Icono personalizado violeta para el Router
const routerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238b5cf6" width="38" height="38">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const routerIcon = L.icon({
  iconUrl: routerSvg,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -32],
})

interface RouterLocationCardProps {
  router: any
  allClients: Client[]
  isAdmin: boolean
  onEditLocation: () => void
}

export function RouterLocationCard({ router, allClients, isAdmin, onEditLocation }: RouterLocationCardProps) {
  const navigate = useNavigate()

  return (
          <div className="glass-card p-5 space-y-3">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <MapPin className="w-4.5 h-4.5" />
              <span>Coordenadas GPS</span>
            </div>
            {router.latitude && router.longitude ? (
              <div className="space-y-3 text-xs">

                {/* Mapa adaptado dentro de la tarjeta de coordenadas */}
                <div className="rounded-lg overflow-hidden h-[240px] border border-border/40 relative shadow-sm z-10">
                  <MapContainer
                    center={[router.latitude, router.longitude]}
                    zoom={13}
                    scrollWheelZoom={true}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* Marcador del Router */}
                    <Marker position={[router.latitude, router.longitude]} icon={routerIcon}>
                      <Popup>
                        <div className="p-1 text-foreground font-sans">
                          <h4 className="font-bold text-sm text-brand-400 flex items-center gap-1.5 m-0">
                            <Server className="w-3.5 h-3.5" />
                            {router.name}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1 mb-0 font-mono">{router.ip}</p>
                          <p className="text-[10px] text-muted-foreground m-0">Clientes: {allClients.length}</p>
                        </div>
                      </Popup>
                    </Marker>

                    {/* Marcadores de los clientes */}
                    {allClients
                      .filter((c: Client) => c.latitude && c.longitude)
                      .map((client: Client) => {
                        const color = client.active ? '%2310b981' : '%23f59e0b'
                        const clientSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="30" height="30">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                          </svg>
                        `)}`
                        const clientIcon = L.icon({
                          iconUrl: clientSvg,
                          iconSize: [26, 26],
                          iconAnchor: [13, 26],
                          popupAnchor: [0, -22],
                        })

                        return (
                          <Marker
                            key={client.id}
                            position={[client.latitude!, client.longitude!]}
                            icon={clientIcon}
                          >
                            <Popup>
                              <div className="p-1 space-y-1.5 text-foreground font-sans min-w-[140px]">
                                <h4 className="font-bold text-xs text-foreground m-0">{client.full_name}</h4>
                                <p className="text-[10px] text-muted-foreground m-0 font-mono">IP: {client.static_ip?.ip ?? 'PPPoE'}</p>
                                <div className="flex items-center justify-between border-t border-border/40 pt-1 mt-1">
                                  <span className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded-full ${client.active
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                                    }`}>
                                    {client.active ? 'activo' : 'suspendido'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => navigate(`/clients/${client.id}`)}
                                    className="text-[9px] uppercase font-bold text-brand-400 hover:underline"
                                  >
                                    Ver Perfil
                                  </button>
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        )
                      })}
                  </MapContainer>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Latitud:</span>
                    <span className="font-mono text-foreground font-semibold">{router.latitude}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Longitud:</span>
                    <span className="font-mono text-foreground font-semibold">{router.longitude}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-muted-foreground">Sin ubicación geográfica registrada.</p>
                {isAdmin && (
                  <button
                    onClick={onEditLocation}
                    className="text-xs text-brand-400 hover:text-brand-300 font-bold mt-2 hover:underline transition-all"
                  >
                    Marcar ubicación en el mapa
                  </button>
                )}
              </div>
            )}
          </div>
  )
}
