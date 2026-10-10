/** useMoveLocation — Guarda la nueva ubicación de un cliente o router movido en el mapa. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'

interface MoveArgs {
  type: 'client' | 'router'
  id: string
  latitude: number
  longitude: number
}

export function useMoveLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ type, id, latitude, longitude }: MoveArgs) =>
      api.put(`/map/locations/${type}/${id}`, { latitude, longitude }),
    onSuccess: (_d, { type }) => {
      qc.invalidateQueries({ queryKey: type === 'client' ? ['clients-map'] : ['routers-list-dropdown'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['routers'] })
    },
  })
}
