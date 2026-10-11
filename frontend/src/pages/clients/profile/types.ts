import type { ToastType } from '@/components/Toast'

export type AddToast = (message: string, type?: ToastType, duration?: number) => void

export interface ClientPlan {
  id: string
  cliente_id: string
  plan_id: string
  fecha_inicio: string
  fecha_fin: string | null
  estado: string
  plan: { name: string; speed_down_mbps: number; speed_up_mbps: number; price: number } | null
}

export type ClientProfileTab = 'plans' | 'suspensions' | 'payments' | 'tickets' | 'traffic' | 'documents'
