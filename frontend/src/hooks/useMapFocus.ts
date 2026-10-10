/** useMapFocus — Registro de marcadores y objetivo de enfoque para localizar un elemento desde el buscador. */
import { useCallback, useRef, useState } from 'react'
import type L from 'leaflet'

export interface FocusTarget {
  key: string
  /** Cambia en cada solicitud para poder enfocar el mismo elemento dos veces seguidas. */
  nonce: number
}

export function useMapFocus() {
  const markers = useRef(new Map<string, L.Marker>())
  const clusterRef = useRef<L.MarkerClusterGroup>(null)
  const [target, setTarget] = useState<FocusTarget | null>(null)

  const register = useCallback((key: string, marker: L.Marker | null) => {
    if (marker) markers.current.set(key, marker)
    else markers.current.delete(key)
  }, [])

  const focus = useCallback((key: string) => setTarget({ key, nonce: Date.now() }), [])

  return { markers, clusterRef, register, target, focus }
}
