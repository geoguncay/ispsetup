/**
 * SiteFormModal — Modal para crear y editar sitios con mapa interactivo.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { X, MapPin, Loader2, Check, Navigation } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/services/api'

const markerSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2310b981" width="36" height="36">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
`)}`

const siteMarkerIcon = L.icon({
  iconUrl: markerSvg,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
})

const DEFAULT_CENTER: [number, number] = [-0.180653, -78.467834]

export interface SiteItem {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
}

interface SiteFormModalProps {
  open: boolean
  onClose: () => void
  site: SiteItem | null
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(
        Number(e.latlng.lat.toFixed(6)),
        Number(e.latlng.lng.toFixed(6)),
      )
    },
  })
  return null
}

function MapController({ center }: { center: [number, number] }) {
  const map = useMap()
  const prevCenter = useRef<[number, number] | null>(null)

  useEffect(() => {
    const prev = prevCenter.current
    const moved =
      !prev ||
      prev[0] !== center[0] ||
      prev[1] !== center[1]

    if (moved && (center[0] !== DEFAULT_CENTER[0] || center[1] !== DEFAULT_CENTER[1])) {
      map.setView(center, map.getZoom())
      prevCenter.current = center
    }
  }, [center, map])

  return null
}

export function SiteFormModal({ open, onClose, site }: SiteFormModalProps) {
  const isEdit = !!site
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [error, setError] = useState<string | null>(null)

  const latNum = lat ? parseFloat(lat) : null
  const lngNum = lng ? parseFloat(lng) : null
  const mapCenter: [number, number] =
    latNum != null && lngNum != null && !isNaN(latNum) && !isNaN(lngNum)
      ? [latNum, lngNum]
      : DEFAULT_CENTER

  useEffect(() => {
    if (open) {
      setName(site?.name ?? '')
      setLat(site?.latitude != null ? String(site.latitude) : '')
      setLng(site?.longitude != null ? String(site.longitude) : '')
      setError(null)
    }
  }, [open, site])

  const handleGetLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(pos.coords.latitude.toFixed(6))
          setLng(pos.coords.longitude.toFixed(6))
        },
        (err) => console.warn('Geolocation error:', err),
        { enableHighAccuracy: true, timeout: 5000 },
      )
    }
  }, [])

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; latitude: number | null; longitude: number | null }) => {
      const { data } = await api.post('/sites', payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites-list'] })
      onClose()
    },
    onError: (err: any) => setError(err.response?.data?.detail ?? 'Error al crear el sitio'),
  })

  const updateMutation = useMutation({
    mutationFn: async (payload: { name: string; latitude: number | null; longitude: number | null }) => {
      const { data } = await api.put(`/sites/${site!.id}`, payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites-list'] })
      onClose()
    },
    onError: (err: any) => setError(err.response?.data?.detail ?? 'Error al actualizar el sitio'),
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      latitude: lat ? parseFloat(lat) : null,
      longitude: lng ? parseFloat(lng) : null,
    }
    if (isEdit) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-2xl mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-foreground">
              {isEdit ? `Editar sitio: ${site!.name}` : 'Agregar sitio'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Nombre del sitio *
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              placeholder="Torre Norte, Nodo Centro, etc."
              className="input-field"
            />
          </div>

          {/* Coordenadas + Mapa */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-brand-400" />
                Ubicación GPS
              </span>
              <button
                type="button"
                onClick={handleGetLocation}
                className="text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1 font-semibold"
              >
                <Navigation className="w-3.5 h-3.5" />
                Usar mi ubicación
              </button>
            </div>

            {/* Inputs manuales */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Latitud
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="-0.180653"
                  className="input-field font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Longitud
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="-78.467834"
                  className="input-field font-mono"
                />
              </div>
            </div>

            {/* Mapa */}
            <div className="rounded-lg border border-border overflow-hidden h-64 relative">
              <MapContainer
                center={mapCenter}
                zoom={12}
                scrollWheelZoom
                style={{ height: '100%', width: '100%', zIndex: 10 }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler
                  onMapClick={(newLat, newLng) => {
                    setLat(String(newLat))
                    setLng(String(newLng))
                  }}
                />
                <MapController center={mapCenter} />
                {latNum != null && lngNum != null && !isNaN(latNum) && !isNaN(lngNum) && (
                  <Marker position={[latNum, lngNum]} icon={siteMarkerIcon} />
                )}
              </MapContainer>
              <p className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 text-[10px] bg-black/50 text-white px-2 py-0.5 rounded-full pointer-events-none">
                Haz clic en el mapa para colocar el marcador
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Footer */}
          <div className="flex gap-3 pt-2 border-t border-border/50">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 justify-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isPending}
              className="btn-primary flex-1 justify-center disabled:opacity-50"
            >
              {isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
              ) : (
                <><Check className="w-4 h-4" /> {isEdit ? 'Guardar cambios' : 'Agregar sitio'}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
