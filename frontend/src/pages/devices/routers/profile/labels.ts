export const SECURITY_MODE_LABELS: Record<string, string> = {
  none_api: 'Sin autenticación · API',
  ppp_api: 'PPP · API',
  hotspot_api: 'Hotspot · API',
}

export const TRAFFIC_ACCOUNTING_LABELS: Record<string, string> = {
  traffic_flow: 'Traffic Flow',
  accounting_v6: 'Accounting v6',
  queue_accounting: 'Colas / Queue accounting',
  none: 'Ninguno',
}

export const SPEED_CONTROL_LABELS: Record<string, string> = {
  pcq_addresslist: 'PCQ + Address List',
  simple_queues: 'Colas simples',
  dhcp_lease_dynamic: 'DHCP + colas dinámicas',
  none: 'Sin control de velocidad',
}
