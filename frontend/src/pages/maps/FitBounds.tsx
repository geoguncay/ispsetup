/** FitBounds — Encuadra el mapa para mostrar todos los puntos; solo al cargar o cambiar `filterKey`. */
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

interface Props {
  points: [number, number][]
  filterKey: string
  ready: boolean
}

export function FitBounds({ points, filterKey, ready }: Props) {
  const map = useMap()
  const lastKey = useRef('')

  useEffect(() => {
    if (!ready || points.length === 0 || lastKey.current === filterKey) return
    lastKey.current = filterKey
    if (points.length === 1) {
      map.flyTo(points[0], 15, { duration: 0.8 })
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16, animate: true })
    }
  }, [filterKey, points, ready, map])

  return null
}
