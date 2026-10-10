/**
 * MarkerCluster — Agrupa los marcadores cercanos en una burbuja con el total; al hacer clic se
 * acerca el mapa y, si están exactamente en el mismo punto, se abren en abanico con su línea guía.
 */
import type { ReactNode, Ref } from 'react'
import type L from 'leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css'
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css'

interface Props {
  /** Si es false, los marcadores se dibujan sueltos (sin agrupar). */
  enabled?: boolean
  clusterRef?: Ref<L.MarkerClusterGroup>
  children: ReactNode
}

export function MarkerCluster({ enabled = true, clusterRef, children }: Props) {
  if (!enabled) return <>{children}</>
  return (
    <MarkerClusterGroup
      ref={clusterRef}
      maxClusterRadius={40}
      showCoverageOnHover={false}
      spiderfyOnMaxZoom
      spiderfyDistanceMultiplier={1.6}
      chunkedLoading
    >
      {children}
    </MarkerClusterGroup>
  )
}
