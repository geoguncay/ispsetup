/** useClientsMap — Datos y filtros (router/sitio) de un mapa de clientes por medio. */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/services/api'
import type { MapClient, MapRouter, MapSite } from '@/pages/maps/mapTypes'

export function useClientsMap(medium: 'radio' | 'fiber') {
  const [routerId, setRouterId] = useState('')
  const [siteId, setSiteId] = useState('')

  const { data: routers = [] } = useQuery<MapRouter[]>({
    queryKey: ['routers-list-dropdown'],
    queryFn: async () => (await api.get('/routers')).data,
  })
  const { data: sites = [] } = useQuery<MapSite[]>({
    queryKey: ['sites-list-dropdown'],
    queryFn: async () => (await api.get('/sites')).data,
  })

  const { data, isLoading, isFetching, isPlaceholderData, refetch } = useQuery<{ items: MapClient[]; total: number }>({
    queryKey: ['clients-map', medium, routerId, siteId],
    queryFn: async () => {
      const params: Record<string, string | number> = { skip: 0, limit: 10000, medium }
      if (routerId) params.router_id = routerId
      if (siteId) params.site_id = siteId
      return (await api.get('/clients', { params })).data
    },
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })

  const clients = useMemo(() => (data?.items ?? []).filter(c => c.latitude && c.longitude), [data])
  const visibleRouters = useMemo(
    () => routers.filter(r => r.latitude != null && r.longitude != null && (!routerId || r.id === routerId)),
    [routers, routerId],
  )
  const fitPoints = useMemo<[number, number][]>(() => [
    ...clients.map(c => [c.latitude!, c.longitude!] as [number, number]),
    ...visibleRouters.map(r => [r.latitude!, r.longitude!] as [number, number]),
  ], [clients, visibleRouters])

  return {
    routers, sites, routerId, siteId, setRouterId, setSiteId,
    clients, total: data?.total ?? 0, visibleRouters, fitPoints,
    isLoading, isFetching, isPlaceholderData, refetch,
    filterKey: `${medium}-${routerId}-${siteId}`,
  }
}
