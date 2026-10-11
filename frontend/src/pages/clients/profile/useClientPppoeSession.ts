import { useQuery, useMutation } from '@tanstack/react-query'
import api from '@/services/api'
import type { AddToast } from './types'

/** Sesión PPPoE activa del cliente (solo si es PPPoE) y acción para desconectarla. */
export function useClientPppoeSession(client: any, pollingPaused: boolean, addToast: AddToast) {
  const { data: pppoeSessions = [], refetch: refetchSessions } = useQuery<any[]>({
    queryKey: ['router-pppoe-sessions', client?.router_id],
    queryFn: async () => {
      if (!client?.router_id) return []
      const { data } = await api.get(`/routers/${client.router_id}/pppoe-sessions`)
      return data
    },
    enabled: !!client && client.access_method === 'pppoe' && !!client.router_id,
    refetchInterval: pollingPaused ? false : 10000,
  })

  // Buscar la sesión correspondiente a este cliente
  const activeSession = pppoeSessions.find(
    (s) => s.username === client?.pppoe_secret?.ppp_username
  )

  // Mutación para desconectar sesión activa
  const disconnectSessionMutation = useMutation({
    mutationFn: async () => {
      if (!client?.router_id || !client?.pppoe_secret?.ppp_username) return
      await api.delete(`/routers/${client.router_id}/pppoe-sessions/${client.pppoe_secret.ppp_username}`)
    },
    onSuccess: () => {
      refetchSessions()
      addToast('Sesión PPPoE desconectada correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al desconectar la sesión activa'
      addToast(msg, 'error')
    }
  })

  return { activeSession, disconnectSessionMutation }
}
