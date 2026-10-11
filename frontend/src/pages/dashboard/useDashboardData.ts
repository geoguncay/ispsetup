import { useQuery } from '@tanstack/react-query'
import api from '@/services/api'
import type { ActivityItem, DashboardSummary, RevenueTrendPoint, RouterRow } from './types'

/** Resumen agregado (infra, clientes, red, finanzas solo admin, alertas). */
export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: async () => (await api.get('/dashboard/summary')).data,
    refetchInterval: 30_000,
  })
}

export function useDashboardActivity(limit = 8) {
  return useQuery<ActivityItem[]>({
    queryKey: ['dashboard-activity', limit],
    queryFn: async () => (await api.get('/dashboard/activity', { params: { limit } })).data.items,
    refetchInterval: 60_000,
  })
}

/** Lista de routers con su estado; el resumen solo trae conteos. */
export function useDashboardRouters() {
  return useQuery<RouterRow[]>({
    queryKey: ['routers'],
    queryFn: async () => (await api.get('/routers')).data,
    refetchInterval: 30_000,
  })
}

/** Ingresos de los últimos meses (solo admin; el backend responde 403 al resto). */
export function useRevenueTrend(enabled: boolean, months = 6) {
  return useQuery<RevenueTrendPoint[]>({
    queryKey: ['dashboard-revenue-trend', months],
    queryFn: async () => (await api.get('/dashboard/revenue-trend', { params: { months } })).data.points,
    enabled,
    refetchInterval: 5 * 60_000,
  })
}
