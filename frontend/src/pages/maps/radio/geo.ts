/** Utilidades geográficas del mapa de radio. */

/** Rumbo en grados (0 = norte, sentido horario) desde `from` hacia `to`. */
export function bearingDeg(from: [number, number], to: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (to[0] - from[0]) * rad
  const dLng = (to[1] - from[1]) * rad * Math.cos(((from[0] + to[0]) / 2) * rad)
  return ((Math.atan2(dLng, dLat) / rad) + 360) % 360
}
