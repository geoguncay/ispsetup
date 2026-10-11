/** Tipos de las respuestas de /api/dashboard/*. Reflejan backend/app/schemas/dashboard.py. */

export type DeviceStatus = 'online' | 'offline' | 'tunnel_down' | 'degraded' | 'unknown'

export interface StatusCounts {
  total: number
  online: number
  offline: number
  tunnel_down: number
  degraded: number
  unknown: number
}

export interface ClientsSummary {
  total: number
  active: number
  suspended: number
  scheduled_suspensions: number
  pending_plan_changes: number
  by_medium: Record<'radio' | 'fiber' | 'unspecified', number>
  by_access_method: Record<'static' | 'pppoe', number>
  without_location: number
}

export interface FinanceSummary {
  collected_today: number
  collected_month: number
  collected_previous_month: number
  pending_invoices: number
  pending_amount: number
  overdue_invoices: number
  overdue_amount: number
  overdue_clients: number
}

export interface NetworkSummary {
  access_points: number
  stations: number
  ptp_links: number
  ptmp_links: number
}

export interface MapPoint {
  id: string
  name: string
  latitude: number
  longitude: number
  kind: 'router' | 'load_balancer' | 'ap' | 'station'
  status: DeviceStatus | null
}

export interface DashboardAlert {
  code: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  count: number
  detail: string | null
  link: string | null
}

export interface DashboardSummary {
  generated_at: string
  infra: { routers: StatusCounts; load_balancers: StatusCounts }
  clients: ClientsSummary
  network: NetworkSummary
  /** Solo admin; el resto de roles recibe null. */
  finance: FinanceSummary | null
  alerts: DashboardAlert[]
  map_points: MapPoint[]
}

export interface ActivityItem {
  id: string
  kind: 'audit' | 'suspension' | 'reactivation'
  action: string
  title: string
  entity_type: string | null
  entity_name: string | null
  user_name: string | null
  created_at: string
}

export interface RouterRow {
  id: string
  name: string
  ip: string
  status: DeviceStatus | null
}

export interface RevenueTrendPoint {
  label: string // "AAAA-MM"
  amount: number
  payments_count: number
}
