/**
 * flipPopup — Si el popup de un marcador no cabe arriba (marcador cerca del borde superior
 * del mapa), lo coloca debajo del marcador para que no quede cortado. El mapa no se mueve.
 */
import L from 'leaflet'

const DEFAULT_OFFSET: [number, number] = [0, 7]
const TIP_AND_MARGIN = 30 // punta del popup + margen de seguridad
const GAP_BELOW = 10

export const flipPopupHandlers = {
  popupopen: (e: L.PopupEvent) => {
    const popup = e.popup
    const marker = (popup as any)._source as L.Marker | undefined
    const map = (popup as any)._map as L.Map | undefined
    const el = popup.getElement()
    if (!marker || !map || !el || !('getLatLng' in marker)) return

    const icon = marker.options.icon?.options
    const popupAnchorY = icon?.popupAnchor?.[1] ?? 0
    const below = icon?.iconSize ? (icon.iconSize as [number, number])[1] - ((icon.iconAnchor as [number, number] | undefined)?.[1] ?? 0) : 0
    const height = el.offsetHeight

    popup.options.offset = L.point(DEFAULT_OFFSET)
    const markerY = map.latLngToContainerPoint(marker.getLatLng()).y
    const spaceAbove = markerY + popupAnchorY - DEFAULT_OFFSET[1] - height - TIP_AND_MARGIN
    const flip = spaceAbove < 0

    el.classList.toggle('popup-below', flip)
    if (flip) popup.options.offset = L.point(0, below + GAP_BELOW + height - popupAnchorY)
    popup.update()
  },
  popupclose: (e: L.PopupEvent) => {
    e.popup.options.offset = L.point(DEFAULT_OFFSET)
  },
}
