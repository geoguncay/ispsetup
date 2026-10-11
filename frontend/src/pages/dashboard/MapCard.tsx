import { Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { MAP_LEGEND } from './mapStyle'
import type { MapPoint } from './types'

const DashboardMap = lazy(() => import('./DashboardMap'))

interface Props {
  points: MapPoint[] | undefined
  loading: boolean
}

export function MapCard({ points, loading }: Props) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Mapa de la red</h2>
        <Link to="/maps/radio" className="text-xs text-brand-400 hover:underline">Abrir mapa</Link>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-16 text-center">Cargando…</p>
      ) : !points || points.length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">
          Ningún equipo tiene ubicación todavía. Asigna coordenadas desde los mapas.
        </p>
      ) : (
        <>
          <div className="relative h-72 overflow-hidden rounded-lg border border-border/40">
            <Suspense fallback={<p className="text-sm text-muted-foreground py-16 text-center">Cargando mapa…</p>}>
              <DashboardMap points={points} />
            </Suspense>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {MAP_LEGEND.map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
