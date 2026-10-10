/** AccessPointMarker — Marcador de un AP o estación; en modo edición se arrastra y el clic abre el modal de edición. */
import { useEffect, useRef } from 'react'
import type L from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import { flipPopupHandlers } from '../flipPopup'
import { apIcon, setRadioIconRotation, stationIcon } from './radioIcons'
import type { MapAccessPoint } from '../mapTypes'

interface Props {
  ap: MapAccessPoint
  editing: boolean
  /** Grados desde el norte a los que apunta el icono (calculado por la página). */
  rotation: number
  /** Se llama mientras se arrastra, para que el AP o la estación pareja giren en vivo. */
  onDrag?: (lat: number, lng: number) => void
  onMove: (lat: number, lng: number) => void
  /** Modo edición: el clic abre el modal de edición en lugar del popup. */
  onEdit: () => void
  /** Registra el marcador (o null al desmontar) para poder localizarlo desde el buscador. */
  registerMarker?: (marker: L.Marker | null) => void
}

export function AccessPointMarker({ ap, editing, rotation, onDrag, onMove, onEdit, registerMarker }: Props) {
  const ref = useRef<L.Marker | null>(null)

  // El giro se aplica sobre el DOM del icono para no recrearlo mientras se arrastra.
  useEffect(() => {
    setRadioIconRotation(ref.current?.getElement(), rotation)
  }, [rotation])

  return (
    <Marker
      ref={(m) => {
        ref.current = m
        registerMarker?.(m)
      }}
      position={[ap.latitude, ap.longitude]}
      icon={ap.role === 'station' ? stationIcon : apIcon}
      draggable={editing}
      eventHandlers={{
        ...(editing ? { click: onEdit } : flipPopupHandlers),
        add: (e) => setRadioIconRotation((e.target as L.Marker).getElement(), rotation),
        drag: (e) => {
          const { lat, lng } = e.target.getLatLng()
          onDrag?.(lat, lng)
        },
        dragend: (e) => {
          const { lat, lng } = e.target.getLatLng()
          onMove(lat, lng)
        },
      }}
    >
      {!editing && (
        <Popup autoPan={false}>
          <div className="p-1 font-sans min-w-[180px] space-y-2">
            <p className="text-[11px] text-muted-foreground m-0">
              {ap.role === 'station' ? 'Antena estación (PtP)' : 'Punto de acceso (AP)'}
            </p>
            <p className="font-bold text-sm text-foreground m-0">{ap.name}</p>
            {(ap.ip || ap.frequency_mhz || ap.channel_width_mhz) && (
              <p className="text-xs text-muted-foreground m-0">
                {[
                  ap.ip,
                  ap.frequency_mhz ? `${ap.frequency_mhz} MHz` : null,
                  ap.channel_width_mhz ? `Canal ${ap.channel_width_mhz} MHz` : null,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="text-[10px] font-mono text-muted-foreground m-0">
              {ap.latitude.toFixed(5)}, {ap.longitude.toFixed(5)}
            </p>
          </div>
        </Popup>
      )}
    </Marker>
  )
}
