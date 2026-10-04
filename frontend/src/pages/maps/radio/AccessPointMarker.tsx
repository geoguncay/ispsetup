/** AccessPointMarker — Marcador de un AP; en modo edición se arrastra y su popup permite renombrar o eliminar. */
import { useState } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { flipPopupHandlers } from '../flipPopup'
import { apIcon, stationIcon } from './radioIcons'
import type { MapAccessPoint } from '../mapTypes'

interface Props {
  ap: MapAccessPoint
  editing: boolean
  onMove: (lat: number, lng: number) => void
  onRename: (name: string) => void
  onDelete: () => void
}

export function AccessPointMarker({ ap, editing, onMove, onRename, onDelete }: Props) {
  const [name, setName] = useState(ap.name)

  return (
    <Marker
      position={[ap.latitude, ap.longitude]}
      icon={ap.role === 'station' ? stationIcon : apIcon}
      draggable={editing}
      eventHandlers={{
        ...flipPopupHandlers,
        dragend: (e) => {
          const { lat, lng } = e.target.getLatLng()
          onMove(lat, lng)
        },
      }}
    >
      {(
        <Popup autoPan={false}>
          <div className="p-1 font-sans min-w-[180px] space-y-2">
            <p className="text-[11px] text-muted-foreground m-0">
              {ap.role === 'station' ? 'Antena estación (PtP)' : 'Punto de acceso (AP)'}
            </p>
            {editing ? (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => name.trim() && name.trim() !== ap.name && onRename(name.trim())}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="input-field w-full text-sm"
                />
                <button
                  type="button"
                  onClick={() => window.confirm(`¿Eliminar el AP "${ap.name}" y sus enlaces?`) && onDelete()}
                  className="text-[10px] uppercase font-bold text-red-400 hover:text-red-300"
                >
                  Eliminar AP
                </button>
              </>
            ) : (
              <p className="font-bold text-sm text-foreground m-0">{ap.name}</p>
            )}
            {(ap.ip || ap.frequency_mhz) && (
              <p className="text-xs text-muted-foreground m-0">
                {ap.ip && <span className="font-mono">{ap.ip}</span>}
                {ap.ip && ap.frequency_mhz ? ' · ' : ''}
                {ap.frequency_mhz ? `${ap.frequency_mhz} MHz` : ''}
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
