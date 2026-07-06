/**
 * Cliente tipado para los endpoints de Ajustes de Sistema (/settings/system/*).
 */
import api from '@/services/api'

export interface LocalizationSettings {
  loc_timezone: string
  loc_locale: string
  loc_currency_code: string
  loc_currency_symbol: string
  loc_date_format: string
}

export interface FiscalSettings {
  fiscal_tax_rate: number
  fiscal_tax_name: string
  fiscal_invoice_prefix: string
  fiscal_invoice_next_number: number
}

export interface SmtpSettingsRead {
  smtp_host: string | null
  smtp_port: number | null
  smtp_user: string | null
  smtp_password_set: boolean
  smtp_from_email: string | null
  smtp_from_name: string | null
  smtp_use_tls: boolean
  sms_notifications_enabled: boolean
}

export interface SecuritySettings {
  sec_password_min_length: number
  sec_password_expiration_days: number
  sec_default_session_timeout_minutes: number
  sec_max_login_attempts: number
  sec_lockout_duration_minutes: number
  sec_ip_whitelist: string[]
}

export interface MaintenanceSettings {
  maint_audit_log_retention_days: number
  maint_maintenance_mode: boolean
  maint_maintenance_message: string | null
}

export interface IntegrationSettingsRead {
  pg_api_key: string | null
  pg_api_secret_set: boolean
}

export interface BillingSettings {
  billing_generation_time: string
  billing_cycle: string
  billing_price_mode: string
  billing_auto_approve_send: boolean
  billing_stop_suspended: boolean
  billing_notify_new_invoice: boolean
  billing_attach_pdf_receipt: boolean
  billing_default_payment_day: number
  billing_default_grace_days: number
  billing_generation_mode: 'fixed_day' | 'cutoff_date' | 'billing_start'
  billing_due_mode: 'fixed_term' | 'cutoff_date'
  billing_due_time: 'start_of_day' | 'end_of_day'
  billing_advance_notice_enabled: boolean
  billing_advance_notice_days: number
  billing_payment_reminders: boolean
  billing_reminder_frequency_days: number
}

export interface SuspensionSettings {
  suspension_automatic: boolean
  suspension_hour: number
  suspension_delay_days: number
  suspension_allow_deferral: boolean
  suspension_notify_suspended: boolean
  suspension_notify_deferred: boolean
  suspension_reasons: string[]
}

export interface PaymentMethodItem {
  value: string
  label: string
  isSystem?: boolean
}

export interface CatalogSettings {
  payment_methods: PaymentMethodItem[]
  cutoff_dates: number[]
  parent_queues: string[]
  address_lists: string[]
}

export interface SystemSettingsRead {
  localization: LocalizationSettings
  fiscal: FiscalSettings
  notifications: SmtpSettingsRead
  security: SecuritySettings
  maintenance: MaintenanceSettings
  integrations: IntegrationSettingsRead
  billing: BillingSettings
  suspension: SuspensionSettings
  catalogs: CatalogSettings
  updated_at: string
}

export interface BackupResult {
  filename: string
  size_bytes: number
  created_at: string
}

export async function getSystemSettings(): Promise<SystemSettingsRead> {
  const { data } = await api.get('/settings/system')
  return data
}

/** Configuración de localización accesible para cualquier usuario autenticado (no requiere rol admin). */
export async function getLocalizationSettings(): Promise<LocalizationSettings> {
  const { data } = await api.get('/settings/localization')
  return data
}

export interface BillingDueDateSettings {
  billing_due_mode: 'fixed_term' | 'cutoff_date'
  billing_due_time: 'start_of_day' | 'end_of_day'
  billing_default_grace_days: number
}

/** Reglas de vencimiento de facturas, accesibles para cualquier usuario autenticado (usado por el simulador de facturación). */
export async function getBillingDueDateSettings(): Promise<BillingDueDateSettings> {
  const { data } = await api.get('/settings/billing-due-date')
  return data
}

/** Catálogos (métodos de pago, fechas de corte), accesibles para cualquier usuario autenticado (usado por el formulario de cliente). */
export async function getCatalogSettings(): Promise<CatalogSettings> {
  const { data } = await api.get('/settings/catalogs')
  return data
}

export async function updateLocalization(payload: Partial<LocalizationSettings>) {
  const { data } = await api.put('/settings/system/localization', payload)
  return data as LocalizationSettings
}

export async function updateFiscal(payload: Partial<FiscalSettings>) {
  const { data } = await api.put('/settings/system/fiscal', payload)
  return data as FiscalSettings
}

export interface SmtpSettingsWrite {
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_user?: string | null
  smtp_password?: string | null
  smtp_from_email?: string | null
  smtp_from_name?: string | null
  smtp_use_tls?: boolean
  sms_notifications_enabled?: boolean
}

export async function updateNotifications(payload: SmtpSettingsWrite) {
  const { data } = await api.put('/settings/system/notifications', payload)
  return data as SmtpSettingsRead
}

export async function updateSecurity(payload: Partial<SecuritySettings>) {
  const { data } = await api.put('/settings/system/security', payload)
  return data as SecuritySettings
}

export async function updateMaintenance(payload: Partial<MaintenanceSettings>) {
  const { data } = await api.put('/settings/system/maintenance', payload)
  return data as MaintenanceSettings
}

export interface IntegrationSettingsWrite {
  pg_api_key?: string | null
  pg_api_secret?: string | null
}

export async function updateIntegrations(payload: IntegrationSettingsWrite) {
  const { data } = await api.put('/settings/system/integrations', payload)
  return data as IntegrationSettingsRead
}

export async function updateBilling(payload: Partial<BillingSettings>) {
  const { data } = await api.put('/settings/system/billing', payload)
  return data as BillingSettings
}

export async function updateSuspension(payload: Partial<SuspensionSettings>) {
  const { data } = await api.put('/settings/system/suspension', payload)
  return data as SuspensionSettings
}

export async function updateCatalogs(payload: Partial<CatalogSettings>) {
  const { data } = await api.put('/settings/system/catalogs', payload)
  return data as CatalogSettings
}

export async function runManualBackup(): Promise<BackupResult> {
  const { data } = await api.post('/settings/system/backup')
  return data
}
