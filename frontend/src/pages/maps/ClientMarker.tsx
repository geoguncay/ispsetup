/** ClientMarker — Pin de un cliente con popup (datos, plan, estado y enlace al perfil). */
import type L from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import { flipPopupHandlers } from './flipPopup'
import { clientIcon, getClientStatus, STATUS_BADGE, STATUS_LABEL, type ClientStatus, type MapClient } from './mapTypes'

interface Props {
  client: MapClient
  /** Icono personalizado según estado; por defecto, el pin estándar. */
  getIcon?: (status: ClientStatus) => L.Icon | L.DivIcon
  /** Si se define, el clic llama a esta función (modo edición) en lugar de abrir el popup. */
  onSelect?: () => void
  /** Modo edición: el pin se arrastra; `revert` lo devuelve a su sitio si falla el guardado. */
  draggable?: boolean
  onMove?: (lat: number, lng: number, revert: () => void) => void
  /** Registra el marcador (o null al desmontar) para poder localizarlo desde el buscador. */
  registerMarker?: (marker: L.Marker | null) => void
}

export function ClientMarker({ client, getIcon = clientIcon, onSelect, draggable = false, onMove, registerMarker }: Props) {
  const navigate = useNavigate()
  const status = getClientStatus(client)

  return (
    <Marker position={[client.latitude!, client.longitude!]} icon={getIcon(status)}
      ref={registerMarker}
      draggable={draggable}
      eventHandlers={{
        ...(onSelect ? { click: onSelect } : flipPopupHandlers),
        dragend: (e) => {
          const marker = e.target as L.Marker
          const { lat, lng } = marker.getLatLng()
          onMove?.(lat, lng, () => marker.setLatLng([client.latitude!, client.longitude!]))
        },
      }}
    >
      {!onSelect && <Popup autoPan={false}>
        <div className="p-1 space-y-2 text-foreground font-sans min-w-[200px]">
          <h4 className="font-bold text-sm text-muted-foreground m-0">{client.full_name}</h4>
          <p className="text-xs text-muted-foreground m-0">Cédula: {client.cedula}</p>
          <p className="text-xs text-muted-foreground m-0">Tel: {client.phone}</p>
          <div className="flex items-center gap-1.5 text-xs mt-1">
            <span className="text-muted-foreground">IP:</span>
            <span className="text-muted-foreground">{client.static_ip?.ip ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-muted-foreground">Plan:</span>
            <span className="text-brand-400 font-medium">{client.plan_activo?.name ?? 'Sin plan'}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-2">
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
            <button
              type="button"
              onClick={() => navigate(`/clients/${client.id}`)}
              className="text-[10px] uppercase font-bold text-brand-400 hover:text-brand-300 transition-colors"
            >
              Ver Perfil &rarr;
            </button>
          </div>
        </div>
      </Popup>}
    </Marker>
  )
}
