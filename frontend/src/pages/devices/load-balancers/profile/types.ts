import type { WanLink } from '@/pages/devices/load-balancers/WanLinkFormDialog'

export interface LoadBalancer {
  id: string
  name: string
  ip: string
  api_port: number
  api_username: string
  hw_model: string | null
  notes: string | null
  latitude: number | null
  longitude: number | null
  site_id?: string | null
  site_name?: string | null
  zerotier_node_id?: string | null
  algorithm: 'pcc' | 'failover'
  wan_links: WanLink[] | null
  last_script_source: string | null
  last_script_applied_at: string | null
  last_script_status: string | null
  status?: 'online' | 'offline' | 'tunnel_down' | 'unknown' | null
  uptime?: string | null
  ros_version?: string | null
}

export interface LbInterface {
  name: string
  running: boolean
  disabled: boolean
  rx_bytes: number
  tx_bytes: number
  rx_rate: number
  tx_rate: number
}

export interface ScriptRun {
  id: string
  origin: 'template' | 'custom'
  algorithm: string | null
  source: string
  success: boolean
  output: string | null
  executed_by_name: string | null
  created_at: string
}

export interface ApplyResult {
  success: boolean
  message: string
  source: string
  output?: string | null
}

export type LbProfileTab = 'info' | 'balanceo' | 'script' | 'puertos' | 'trafico' | 'historial'
