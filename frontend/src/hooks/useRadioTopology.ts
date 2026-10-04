/** useRadioTopology — APs y enlaces editables del mapa de radio. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import type { LinkKind, MapAccessPoint, MapLink, NodeRef, NodeType } from '@/pages/maps/mapTypes'

const AP_KEY = ['map-access-points']
const LINK_KEY = ['map-links']

export function useRadioTopology() {
  const qc = useQueryClient()

  const { data: accessPoints = [] } = useQuery<MapAccessPoint[]>({
    queryKey: AP_KEY,
    queryFn: async () => (await api.get('/map/access-points')).data,
  })
  const { data: links = [] } = useQuery<MapLink[]>({
    queryKey: LINK_KEY,
    queryFn: async () => (await api.get('/map/links')).data,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: AP_KEY })
    qc.invalidateQueries({ queryKey: LINK_KEY })
  }

  const createAp = useMutation({
    mutationFn: async (body: {
      name: string; latitude: number; longitude: number
      ip?: string | null; frequency_mhz?: number | null; connect_to?: NodeRef | null
    }) => (await api.post('/map/access-points', body)).data,
    onSuccess: refresh,
  })
  const createPtp = useMutation({
    mutationFn: async (body: {
      ap: { name: string; latitude: number; longitude: number; ip?: string | null }
      station: { name: string; latitude: number; longitude: number; ip?: string | null }
      frequency_mhz?: number | null
      connect_to?: NodeRef | null
    }) => (await api.post('/map/ptp', body)).data,
    onSuccess: refresh,
  })
  const updateAp = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name?: string; latitude?: number; longitude?: number }) =>
      (await api.put(`/map/access-points/${id}`, body)).data,
    onSuccess: refresh,
  })
  const deleteAp = useMutation({
    mutationFn: async (id: string) => api.delete(`/map/access-points/${id}`),
    onSuccess: refresh,
  })
  const createLink = useMutation({
    mutationFn: async (body: { kind: LinkKind; source_type: NodeType; source_id: string; target_type: NodeType; target_id: string }) =>
      (await api.post('/map/links', body)).data,
    onSuccess: refresh,
  })
  const updateLink = useMutation({
    mutationFn: async ({ id, ...body }: {
      id: string; kind?: LinkKind
      source_type?: NodeType; source_id?: string; target_type?: NodeType; target_id?: string
    }) => (await api.put(`/map/links/${id}`, body)).data,
    onSuccess: refresh,
  })
  const deleteLink = useMutation({
    mutationFn: async (id: string) => api.delete(`/map/links/${id}`),
    onSuccess: refresh,
  })

  return { accessPoints, links, createAp, createPtp, updateAp, deleteAp, createLink, updateLink, deleteLink }
}
