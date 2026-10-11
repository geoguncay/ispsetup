import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/services/api'
import type { WanLink } from '@/pages/devices/load-balancers/WanLinkFormDialog'
import type { ApplyResult, LoadBalancer } from './types'

/**
 * Estado y acciones de la configuración de balanceo (algoritmo + enlaces WAN).
 * Vive en la página (no en la pestaña) para que sobreviva al cambio de pestañas.
 */
export function useLoadBalancerBalancing(
  id: string | undefined,
  lb: LoadBalancer | undefined,
  /** Estado del modal de enlace WAN: lo posee la página para pausar el polling. */
  linkModal: { editingIndex: number | null; close: () => void },
) {
  const queryClient = useQueryClient()

  const [algorithm, setAlgorithm] = useState<'pcc' | 'failover'>('pcc')
  const [wanLinks, setWanLinks] = useState<WanLink[]>([])
  const [balancingLoaded, setBalancingLoaded] = useState(false)
  // true cuando la configuración guardada tiene cambios que todavía no se aplicaron en el equipo.
  const [pendingApply, setPendingApply] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)

  // Se sincroniza una sola vez al cargar; después la edición es local.
  useEffect(() => {
    if (lb && !balancingLoaded) {
      setAlgorithm(lb.algorithm || 'pcc')
      setWanLinks(lb.wan_links ?? [])
      setPendingApply(lb.last_script_status !== 'success')
      setBalancingLoaded(true)
    }
  }, [lb, balancingLoaded])

  const saveBalancingMutation = useMutation({
    mutationFn: async (payload: { algorithm: 'pcc' | 'failover'; wan_links: WanLink[] }) => {
      const { data } = await api.put(`/load-balancers/${id}/balancing`, payload)
      return data
    },
    onSuccess: (data) => {
      setAlgorithm(data.algorithm)
      setWanLinks(data.wan_links ?? [])
      setPendingApply(true)
      queryClient.invalidateQueries({ queryKey: ['load-balancer', id] })
    },
  })

  const applyTemplateMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/load-balancers/${id}/apply-template`)
      return data as ApplyResult
    },
    onSuccess: (data) => {
      setApplyResult(data)
      if (data.success) setPendingApply(false)
      queryClient.invalidateQueries({ queryKey: ['load-balancer', id] })
      queryClient.invalidateQueries({ queryKey: ['load-balancer-script-runs', id] })
    },
    onError: (err: any) => {
      setApplyResult({
        success: false,
        message: err?.response?.data?.detail || 'Error al aplicar la plantilla en el balanceador',
        source: '',
      })
    },
  })

  const handleAlgorithmChange = (next: 'pcc' | 'failover') => {
    if (next === algorithm) return
    setApplyResult(null)
    saveBalancingMutation.mutate({ algorithm: next, wan_links: wanLinks })
  }

  const handleRemoveLink = (index: number) => {
    if (!confirm('¿Quitar este enlace WAN de la configuración?')) return
    setApplyResult(null)
    saveBalancingMutation.mutate({ algorithm, wan_links: wanLinks.filter((_, i) => i !== index) })
  }

  const handleLinkModalSave = (link: WanLink) => {
    setApplyResult(null)
    const nextLinks = linkModal.editingIndex !== null
      ? wanLinks.map((l, i) => (i === linkModal.editingIndex ? link : l))
      : [...wanLinks, link]
    saveBalancingMutation.mutate(
      { algorithm, wan_links: nextLinks },
      { onSuccess: linkModal.close }
    )
  }

  const handleApplyTemplate = () => {
    if (wanLinks.length < 2) return
    if (!confirm('Esto aplicará reglas de firewall y rutas reales en el balanceador. ¿Continuar?')) return
    setApplyResult(null)
    applyTemplateMutation.mutate()
  }

  return {
    algorithm,
    wanLinks,
    pendingApply,
    applyResult,
    isSaving: saveBalancingMutation.isPending,
    isApplying: applyTemplateMutation.isPending,
    handleAlgorithmChange,
    handleRemoveLink,
    handleLinkModalSave,
    handleApplyTemplate,
  }
}
