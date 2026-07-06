/**
 * Ajustes de Sistema — contenedor de la pestaña "Facturación" en SettingsPage.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt, Save, Loader2 } from 'lucide-react'
import { getSystemSettings, updateBilling, type BillingSettings } from '@/services/systemSettings'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

function BillingGeneralForm({
  data, onSaved, setStatusMessage,
}: { data: BillingSettings; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const [dirty, setDirty] = useState(false)
  const [generationMode, setGenerationMode] = useState<'fixed_day' | 'cutoff_date' | 'billing_start'>(data.billing_generation_mode || 'fixed_day')
  const [dueMode, setDueMode] = useState<'fixed_term' | 'cutoff_date'>(data.billing_due_mode || 'fixed_term')

  const mutation = useMutation({
    mutationFn: updateBilling,
    onSuccess: () => {
      onSaved()
      setDirty(false)
      setStatusMessage({ type: 'success', text: 'Las políticas de facturación global se actualizaron correctamente.' })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setStatusMessage({ type: 'error', text: msg || 'Error al guardar la facturación.' })
    },
  })

  return (
    <div className="glass-card p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Receipt className="w-5 h-5 text-brand-400" />
          Configuración de Facturación
        </h3>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const target = e.currentTarget as any
          mutation.mutate({
            billing_generation_time: target.generationTime.value,
            billing_cycle: target.billingCycle.value,
            billing_price_mode: target.priceMode.value,
            billing_generation_mode: target.generationMode.value,
            ...(target.fixedDayGeneration ? { billing_default_payment_day: parseInt(target.fixedDayGeneration.value, 10) } : {}),
            billing_auto_approve_send: target.autoApproveSend.checked,
            billing_stop_suspended: target.stopSuspended.checked,
            billing_notify_new_invoice: target.notifyNewInvoice.checked,
            billing_attach_pdf_receipt: target.attachPdfReceipt.checked,
            billing_due_mode: target.dueMode.value,
            billing_due_time: target.dueTime.value,
            ...(target.defaultGraceDays ? { billing_default_grace_days: parseInt(target.defaultGraceDays.value, 10) } : {}),
            billing_advance_notice_enabled: target.advanceNoticeEnabled.checked,
            billing_advance_notice_days: parseInt(target.advanceNoticeDays.value, 10),
            billing_payment_reminders: target.paymentReminders.checked,
            billing_reminder_frequency_days: parseInt(target.reminderFrequencyDays.value, 10),
          })
        }}
        onChange={() => setDirty(true)}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Ciclo de facturación por defecto
            </label>
            <select
              name="billingCycle"
              defaultValue={data.billing_cycle || 'monthly'}
              className="input-field"
            >
              <option value="monthly">Mensual</option>
              <option value="bimonthly">Bimestral</option>
              <option value="quarterly">Trimestral</option>
              <option value="biannual">Semestral</option>
              <option value="annual">Anual</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Modo de precio
            </label>
            <select
              name="priceMode"
              defaultValue={data.billing_price_mode || 'included'}
              className="input-field"
            >
              <option value="included">Precios incluyendo impuestos</option>
              <option value="excluded">Precios excluyendo impuestos</option>
            </select>
          </div>
        </div>

        <hr className="border-border/50" />

        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Generación de Facturas
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="generationMode" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Determina el día
              </label>
              <select
                id="generationMode"
                name="generationMode"
                defaultValue={data.billing_generation_mode || 'fixed_day'}
                onChange={(e) => setGenerationMode(e.target.value as 'fixed_day' | 'cutoff_date' | 'billing_start')}
                className="input-field"
              >
                <option value="fixed_day">Día fijo del mes</option>
                <option value="cutoff_date">Día de corte del cliente</option>
                <option value="billing_start">Inicio de facturación del cliente</option>
              </select>
              <span className="text-[11px] text-muted-foreground block">
                {generationMode === 'cutoff_date'
                  ? 'La factura se genera el mismo día de corte configurado en el perfil de cada cliente.'
                  : generationMode === 'billing_start'
                  ? 'La factura se genera el mismo día del mes en que inició la facturación de cada cliente.'
                  : 'La factura se genera el mismo día del mes para todos los clientes (configurable a la derecha).'}
              </span>
            </div>

            {generationMode === 'fixed_day' && (
              <div className="space-y-1.5">
                <label htmlFor="fixedDayGeneration" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Día del mes
                </label>
                <input
                  id="fixedDayGeneration"
                  name="fixedDayGeneration"
                  type="number"
                  min="1"
                  max="28"
                  defaultValue={String(data.billing_default_payment_day ?? 5)}
                  className="input-field font-mono"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="generationTime" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Hora de generación
              </label>
              <input
                id="generationTime"
                name="generationTime"
                type="time"
                defaultValue={data.billing_generation_time || '08:00'}
                className="input-field font-mono"
              />
            </div>
          </div>
        </div>

        <hr className="border-border/50" />

        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Vencimiento de Facturas
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="dueMode" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Cómo se calcula el vencimiento
              </label>
              <select
                id="dueMode"
                name="dueMode"
                defaultValue={data.billing_due_mode || 'fixed_term'}
                onChange={(e) => setDueMode(e.target.value as 'fixed_term' | 'cutoff_date')}
                className="input-field"
              >
                <option value="fixed_term">Plazo fijo desde la emisión</option>
                <option value="cutoff_date">Fecha de corte del cliente</option>
              </select>
              <span className="text-[11px] text-muted-foreground block">
                {dueMode === 'cutoff_date'
                  ? 'La factura vence el mismo día de corte configurado en el perfil del cliente.'
                  : 'La factura vence N días después de emitida (configurable a la derecha).'}
              </span>
            </div>

            {dueMode === 'fixed_term' && (
              <div className="space-y-1.5">
                <label htmlFor="defaultGraceDays" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Días de plazo
                </label>
                <input
                  id="defaultGraceDays"
                  name="defaultGraceDays"
                  type="number"
                  min="0"
                  defaultValue={String(data.billing_default_grace_days ?? 10)}
                  className="input-field font-mono"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="dueTime" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Hora del vencimiento
              </label>
              <select
                id="dueTime"
                name="dueTime"
                defaultValue={data.billing_due_time || 'end_of_day'}
                className="input-field"
              >
                <option value="end_of_day">Fin del día (23:59:59)</option>
                <option value="start_of_day">Inicio del día (00:00:00)</option>
              </select>
            </div>
          </div>

          <div className="bg-brand-500/10 border border-brand-500/20 rounded-lg p-3 text-[11px] text-brand-300 leading-relaxed">
            ℹ️ Los "Días de gracia antes de suspender" (extra, después del vencimiento) se configuran en la pestaña Suspensión.
          </div>
        </div>

        <hr className="border-border/50" />

        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Políticas de Automatización
          </h4>

          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                <input name="autoApproveSend" type="checkbox" defaultChecked={data.billing_auto_approve_send ?? true} className="sr-only peer" />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
              </label>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Aprobar y enviar facturas automáticamente
                </span>
                <span className="text-xs text-muted-foreground">
                  Los borradores de facturas se aprueban y se envían automáticamente al cliente inmediatamente después de ser generados.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                <input name="stopSuspended" type="checkbox" defaultChecked={data.billing_stop_suspended ?? true} className="sr-only peer" />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
              </label>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Detener la facturación de servicios suspendidos
                </span>
                <span className="text-xs text-muted-foreground">
                  No se facturarán los períodos de facturación que estén cubiertos en su totalidad por una suspensión del servicio.
                </span>
              </div>
            </div>
          </div>
        </div>

        <hr className="border-border/50" />

        <div className="space-y-4">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Notificaciones y Avisos a Clientes
          </h4>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                <input name="notifyNewInvoice" type="checkbox" defaultChecked={data.billing_notify_new_invoice ?? true} className="sr-only peer" />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
              </label>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Notificar Factura nueva
                </span>
                <span className="text-xs text-muted-foreground">
                  Enviar automáticamente un correo electrónico de notificación al cliente cuando se genera una nueva factura.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                <input name="attachPdfReceipt" type="checkbox" defaultChecked={data.billing_attach_pdf_receipt ?? true} className="sr-only peer" />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
              </label>
              <div>
                <span className="text-sm font-medium text-foreground block">
                  Adjuntar el recibo como archivo PDF
                </span>
                <span className="text-xs text-muted-foreground">
                  Adjuntar el archivo PDF de la factura/recibo de pago en el correo de notificación saliente.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                    <input name="advanceNoticeEnabled" type="checkbox" defaultChecked={data.billing_advance_notice_enabled ?? true} className="sr-only peer" />
                    <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                  </label>
                  <div>
                    <span className="text-xs font-semibold text-foreground block">Aviso de nueva factura</span>
                    <span className="text-[10px] text-muted-foreground">Enviar un aviso previo al cliente.</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground block uppercase">Días de aviso previo</label>
                  <input
                    name="advanceNoticeDays"
                    type="number"
                    min="1"
                    defaultValue={String(data.billing_advance_notice_days ?? 5)}
                    className="input-field py-1 px-2 text-xs font-mono w-24"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                    <input name="paymentReminders" type="checkbox" defaultChecked={data.billing_payment_reminders ?? true} className="sr-only peer" />
                    <div className="w-11 h-6 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-muted-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:after:bg-white peer-checked:after:border-brand-500"></div>
                  </label>
                  <div>
                    <span className="text-xs font-semibold text-foreground block">Recordatorios de pago</span>
                    <span className="text-[10px] text-muted-foreground">Enviar recordatorios automáticos de facturas pendientes.</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground block uppercase">Enviar recordatorio cada (días)</label>
                  <input
                    name="reminderFrequencyDays"
                    type="number"
                    min="1"
                    defaultValue={String(data.billing_reminder_frequency_days ?? 3)}
                    className="input-field py-1 px-2 text-xs font-mono w-24"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-border/50">
          <button type="submit" className={dirty ? 'btn-primary' : 'btn-secondary'}>
            <Save className="w-4 h-4" />
            Guardar
          </button>
        </div>
      </form>
    </div>
  )
}

export function BillingSettingsTab({ isAdmin, setStatusMessage }: { isAdmin: boolean; setStatusMessage: StatusSetter }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSystemSettings,
    enabled: isAdmin,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-settings'] })

  if (isLoading || !data) {
    return (
      <div className="glass-card p-12 flex items-center justify-center animate-fade-in">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <BillingGeneralForm data={data.billing} onSaved={invalidate} setStatusMessage={setStatusMessage} />
    </div>
  )
}
