export const ACTION_LABELS: Record<string, string> = {
  USER_LOGIN: 'Inicio de sesión', USER_LOGIN_FAILED: 'Acceso rechazado', USER_LOGOUT: 'Cierre de sesión',
  USER_CREATE: 'Usuario creado', USER_UPDATE: 'Usuario actualizado', USER_DELETE: 'Usuario eliminado', USER_AVATAR_UPDATE: 'Avatar actualizado',
  CREATE_GATEWAY: 'Router creado', UPDATE_GATEWAY: 'Router actualizado', DELETE_GATEWAY: 'Router eliminado',
  GATEWAY_ONLINE: 'Router en línea', GATEWAY_OFFLINE: 'Router fuera de línea', IMPORT_CLIENTS: 'Clientes importados del router',
  TEST_GATEWAY_CONNECTION: 'Conexión de router probada', UPDATE_GATEWAY_QUEUE: 'Cola padre actualizada',
  SYNC_PPPOE_PROFILES: 'Perfiles PPPoE sincronizados', SYNC_GATEWAY: 'Router sincronizado', TERMINATE_PPPOE_SESSION: 'Sesión PPPoE terminada',
  CREATE_CLIENT: 'Cliente creado', UPDATE_CLIENT: 'Cliente actualizado', DELETE_CLIENT: 'Cliente eliminado',
  SUSPEND_CLIENT: 'Cliente suspendido', ACTIVATE_CLIENT: 'Cliente activado', SYNC_CLIENT: 'Cliente sincronizado',
  IMPORT_CLIENT_FILE: 'Archivo de clientes importado', CREATE_TICKET: 'Ticket creado', ASSIGN_PLAN: 'Plan asignado', TOGGLE_QUEUE: 'Estado de cola modificado',
  CREATE_PLAN: 'Plan creado', UPDATE_PLAN: 'Plan actualizado', DELETE_PLAN: 'Plan eliminado',
  CREATE_PAYMENT: 'Pago registrado', CREATE_INVOICE: 'Factura creada', GENERATE_MONTHLY_INVOICES: 'Facturación mensual ejecutada',
  MARK_INVOICES_OVERDUE: 'Vencimientos actualizados', UPDATE_COMPANY: 'Empresa actualizada', UPDATE_COMPANY_LOGO: 'Logo actualizado',
  UPDATE_LOGIN_BACKGROUND: 'Fondo de acceso actualizado', CREATE_SITE: 'Sitio creado', UPDATE_SITE: 'Sitio actualizado', DELETE_SITE: 'Sitio eliminado',
  CREATE_CUSTOM_SERVICE: 'Servicio creado', UPDATE_CUSTOM_SERVICE: 'Servicio actualizado', DELETE_CUSTOM_SERVICE: 'Servicio eliminado',
  CREATE_SUPPLIER: 'Proveedor creado', UPDATE_SUPPLIER: 'Proveedor actualizado', DELETE_SUPPLIER: 'Proveedor eliminado',
  CREATE_PRODUCT_CATEGORY: 'Categoría creada', UPDATE_PRODUCT_CATEGORY: 'Categoría actualizada',
  CREATE_INVENTORY_ITEM: 'Artículo creado', UPDATE_INVENTORY_ITEM: 'Artículo actualizado', DELETE_INVENTORY_ITEM: 'Artículo eliminado',
  IMPORT_INVENTORY: 'Inventario importado', UPDATE_LOCALIZATION_SETTINGS: 'Localización actualizada', UPDATE_FISCAL_SETTINGS: 'Ajustes fiscales actualizados',
  UPDATE_SMTP_SETTINGS: 'Notificaciones actualizadas', UPDATE_SECURITY_SETTINGS: 'Seguridad actualizada',
  UPDATE_MAINTENANCE_SETTINGS: 'Mantenimiento actualizado', UPDATE_INTEGRATION_SETTINGS: 'Integraciones actualizadas',
  UPDATE_BILLING_SETTINGS: 'Facturación actualizada', UPDATE_SUSPENSION_SETTINGS: 'Suspensiones actualizadas',
  UPDATE_CATALOG_SETTINGS: 'Catálogos actualizados', UPDATE_MIKROTIK_API_SETTINGS: 'API MikroTik actualizada',
  UPDATE_ZEROTIER_SETTINGS: 'ZeroTier actualizado', AUTHORIZE_ZT_MEMBER: 'Miembro de ZeroTier autorizado',
  SYSTEM_BACKUP: 'Respaldo generado',
}

export const ACTION_OPTIONS = Object.entries(ACTION_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'es'))

export const ENTITY_OPTIONS = [
  ['Router', 'Router'], ['Client', 'Cliente'], ['User', 'Usuario'], ['Plan', 'Plan'],
  ['Invoice', 'Factura'], ['InvoiceBatch', 'Facturación'], ['Payment', 'Pago'], ['Company', 'Empresa'],
  ['Site', 'Sitio'], ['Ticket', 'Ticket'], ['CustomService', 'Servicio'], ['Supplier', 'Proveedor'],
  ['ProductCategory', 'Categoría'], ['InventoryItem', 'Inventario'], ['InventoryImport', 'Importación de inventario'],
  ['ClientImport', 'Importación de clientes'], ['SystemSettings', 'Ajustes del sistema'], ['System', 'Sistema'],
  ['ZeroTierMember', 'Miembro de ZeroTier'],
] as const

export interface AuditLogRecord {
  id: string
  user_id: string | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string
  entity_name: string
  detail: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export interface AuditLogGroup {
  id: string
  action: string
  count: number
  latest_at: string
  earliest_at: string
  items: AuditLogRecord[]
}

export interface AuditLogGroupedResponse {
  items: AuditLogGroup[]
  total: number
  event_total: number
}
