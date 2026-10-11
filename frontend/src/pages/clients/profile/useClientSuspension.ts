import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import type { AddToast } from './types'

/**
 * Flujo de suspensión del cliente: suspender, aplazar, reactivar, programar o
 * cancelar reactivaciones, e historial de suspensiones. Concentra el estado de
 * los diálogos para que la página pueda pausar el polling mientras hay uno abierto.
 */
export function useClientSuspension(id: string | undefined, addToast: AddToast) {
  const queryClient = useQueryClient()

  const [suspendOpen, setSuspendOpen] = useState(false)
  const [deferOpen, setDeferOpen] = useState(false)
  const [confirmCancelDeferOpen, setConfirmCancelDeferOpen] = useState(false)
  const [confirmCancelReactivationOpen, setConfirmCancelReactivationOpen] = useState(false)
  const [deferReactivationOpen, setDeferReactivationOpen] = useState(false)
  const [deferReactivationDate, setDeferReactivationDate] = useState('')
  const [suspensionReason, setSuspensionReason] = useState('')
  const [suspensionReasons, setSuspensionReasons] = useState<string[]>([])
  const [deferDate, setDeferDate] = useState('')
  const [suspendUntilMode, setSuspendUntilMode] = useState<'indefinido' | 'hasta'>('indefinido')
  const [suspendUntilDate, setSuspendUntilDate] = useState('')
  const allowDeferral = localStorage.getItem('isp_suspension_allow_deferral') !== 'false'

  // Las acciones manuales marcan esta ref para no duplicar el toast de cambio automático.
  const suppressAutoToastRef = useRef(false)

  useEffect(() => {
    if (suspendOpen || deferOpen) {
      const saved = localStorage.getItem('isp_suspension_reasons_list')
      const defaults = ['Falta de pago', 'Solicitud del cliente', 'Mantenimiento', 'Incumplimiento de contrato']
      if (saved) {
        try { setSuspensionReasons(JSON.parse(saved)) } catch { setSuspensionReasons(defaults) }
      } else {
        setSuspensionReasons(defaults)
      }
      setSuspensionReason('')
      setDeferDate('')
      setSuspendUntilMode('indefinido')
      setSuspendUntilDate('')
    }
  }, [suspendOpen, deferOpen])

  useEffect(() => {
    if (deferReactivationOpen) {
      setDeferReactivationDate('')
    }
  }, [deferReactivationOpen])

  // Mutación para suspender cliente
  const suspendClientMutation = useMutation({
    mutationFn: async ({ reason, reactivateAt }: { reason: string; reactivateAt?: string }) => {
      await api.post(`/clients/${id}/suspend`, null, {
        params: { reason, ...(reactivateAt ? { reactivate_at: reactivateAt } : {}) }
      })
    },
    onSuccess: () => {
      suppressAutoToastRef.current = true
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-suspensions', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setSuspendOpen(false)
      setSuspensionReason('')
      setSuspendUntilMode('indefinido')
      setSuspendUntilDate('')
      addToast('Cliente suspendido correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al suspender al cliente'
      addToast(msg, 'error')
    }
  })

  // Mutación para aplazar suspensión a una fecha específica
  const deferClientMutation = useMutation({
    mutationFn: async ({ deferUntil, reason }: { deferUntil: string; reason: string }) => {
      await api.post(`/clients/${id}/defer-suspension`, null, {
        params: { defer_until: deferUntil, reason }
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeferOpen(false)
      setSuspensionReason('')
      setDeferDate('')
      addToast('Suspensión programada correctamente.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al programar la suspensión', 'error')
    }
  })

  // Mutación para cancelar una suspensión aplazada
  const cancelDeferMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}/defer-suspension`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Suspensión programada cancelada.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al cancelar el aplazamiento', 'error')
    }
  })

  // Mutación para cancelar una reactivación programada (suspensión "hasta" una fecha)
  const cancelScheduledReactivationMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/clients/${id}/scheduled-reactivation`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Reactivación programada cancelada.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al cancelar la reactivación programada', 'error')
    }
  })

  // Mutación para programar (o reprogramar) la reactivación automática de un cliente ya suspendido
  const deferReactivationMutation = useMutation({
    mutationFn: async (reactivateAt: string) => {
      await api.post(`/clients/${id}/scheduled-reactivation`, null, { params: { reactivate_at: reactivateAt } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      setDeferReactivationOpen(false)
      setDeferReactivationDate('')
      addToast('Reactivación programada correctamente.', 'success')
    },
    onError: (err: any) => {
      addToast(err?.response?.data?.detail || 'Error al programar la reactivación', 'error')
    }
  })

  // Mutación para reactivar cliente
  const reactivateClientMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/clients/${id}/reactivate`)
    },
    onSuccess: () => {
      suppressAutoToastRef.current = true
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-plans', id] })
      queryClient.invalidateQueries({ queryKey: ['client-suspensions', id] })
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      addToast('Cliente reactivado correctamente.', 'success')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || 'Error al reactivar al cliente'
      addToast(msg, 'error')
    }
  })

  // Consultar Historial de Suspensiones
  const { data: suspensionHistory = [], isLoading: isLoadingSuspensions } = useQuery({
    queryKey: ['client-suspensions', id],
    queryFn: async () => {
      const { data } = await api.get(`/clients/${id}/suspensions`)
      return data
    }
  })

  // Suspensión activa (la más reciente sin fecha de reactivación), usada para el banner de detalle
  const activeSuspension = suspensionHistory.find((sh: any) => !sh.reactivated_at)

  const anyDialogOpen = suspendOpen || deferOpen || confirmCancelDeferOpen ||
    confirmCancelReactivationOpen || deferReactivationOpen

  return {
    allowDeferral,
    anyDialogOpen,
    suppressAutoToastRef,
    suspendOpen, setSuspendOpen,
    deferOpen, setDeferOpen,
    confirmCancelDeferOpen, setConfirmCancelDeferOpen,
    confirmCancelReactivationOpen, setConfirmCancelReactivationOpen,
    deferReactivationOpen, setDeferReactivationOpen,
    deferReactivationDate, setDeferReactivationDate,
    suspensionReason, setSuspensionReason,
    suspensionReasons,
    deferDate, setDeferDate,
    suspendUntilMode, setSuspendUntilMode,
    suspendUntilDate, setSuspendUntilDate,
    suspendClientMutation,
    deferClientMutation,
    cancelDeferMutation,
    cancelScheduledReactivationMutation,
    deferReactivationMutation,
    reactivateClientMutation,
    suspensionHistory,
    isLoadingSuspensions,
    activeSuspension,
  }
}

export type ClientSuspension = ReturnType<typeof useClientSuspension>
