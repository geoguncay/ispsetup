/** FocusController — Lleva el mapa a un elemento (abriendo su grupo si hace falta) y lo resalta con un anillo. */
import { useEffect, useState, type RefObject } from 'react'
import type L from 'leaflet'
import { CircleMarker, useMap } from 'react-leaflet'
import type { FocusTarget } from '@/hooks/useMapFocus'

interface Props {
  target: FocusTarget | null
  markers: RefObject<Map<string, L.Marker>>
  clusterRef: RefObject<L.MarkerClusterGroup | null>
  /** Abre el popup del elemento al llegar (modo Ver). */
  openPopup: boolean
}

const RING_MS = 4500
const MAX_TRIES = 15

export function FocusController({ target, markers, clusterRef, openPopup }: Props) {
  const map = useMap()
  const [ring, setRing] = useState<[number, number] | null>(null)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    let tries = 0
    let retry: number | undefined

    const attempt = () => {
      if (cancelled) return
      const marker = markers.current?.get(target.key)
      // Si el elemento acaba de mostrarse (capa activada) su marcador aún no se registró.
      if (!marker) {
        if (tries++ < MAX_TRIES) retry = window.setTimeout(attempt, 80)
        return
      }
      const show = () => {
        if (cancelled) return
        const ll = marker.getLatLng()
        setRing([ll.lat, ll.lng])
        if (openPopup) marker.openPopup()
      }
      const cluster = clusterRef.current
      if (cluster?.hasLayer(marker)) {
        cluster.zoomToShowLayer(marker, show)
      } else {
        map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.6 })
        window.setTimeout(show, 700)
      }
    }

    attempt()
    const hide = window.setTimeout(() => setRing(null), RING_MS)
    return () => {
      cancelled = true
      window.clearTimeout(retry)
      window.clearTimeout(hide)
    }
  }, [target, markers, clusterRef, map, openPopup])

  if (!ring) return null
  return (
    <CircleMarker
      center={ring}
      radius={26}
      interactive={false}
      pathOptions={{ className: 'map-focus-ring', color: '#ef4444', weight: 3, fill: false }}
    />
  )
}
