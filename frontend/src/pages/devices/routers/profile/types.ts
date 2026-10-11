export interface Client {
  id: string
  full_name: string
  cedula: string
  phone: string
  access_method: 'static' | 'pppoe'
  medium?: 'radio' | 'fiber' | 'unspecified'
  active: boolean
  latitude: number | null
  longitude: number | null
  plan_activo?: { name: string; speed_down_mbps?: number; speed_up_mbps?: number } | null
  static_ip?: { ip: string } | null
}

export type RouterProfileTab = 'stats' | 'clients' | 'queues' | 'pppoe' | 'logs' | 'historial'
