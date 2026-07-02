import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Receipt, Save } from 'lucide-react'
import { updateBilling, type BillingSettings } from '@/services/systemSettings'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

export function BillingGeneralForm({
  data, onSaved, setStatusMessage,
}: { data: BillingSettings; onSaved: () => void; setStatusMessage: StatusSetter }) {
  const [dirty, setDirty] = useState(false)

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
        <p className="text-muted-foreground text-xs mt-1">
          Administra las políticas de facturación automática, ciclos de cobro y notificaciones de pago a tus suscriptores.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const target = e.currentTarget as any
          mutation.mutate({
            billing_hora_generacion: target.horaGeneracion.value,
            billing_ciclo: target.cicloFacturacion.value,
            billing_modo_precio: target.modoPrecio.value,
            billing_auto_aprobar_enviar: target.autoAprobarEnviar.checked,
            billing_detener_suspendidos: target.detenerSuspendidos.checked,
            billing_notify_new_invoice: target.notifyNewInvoice.checked,
            billing_attach_pdf_receipt: target.attachPdfReceipt.checked,
            billing_default_dia_pago: parseInt(target.defaultDiaPago.value, 10),
            billing_default_dias_gracia: parseInt(target.defaultDiasGracia.value, 10),
            billing_aviso_nueva_factura: target.avisoNuevaFactura.checked,
            billing_aviso_previo_dias: parseInt(target.avisoPrevioDias.value, 10),
            billing_recordatorios_pago: target.recordatoriosPago.checked,
            billing_recordatorio_frecuencia_dias: parseInt(target.recordatorioFrecuenciaDias.value, 10),
          })
        }}
        onChange={() => setDirty(true)}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Hora de generación de facturas
            </label>
            <input
              name="horaGeneracion"
              type="time"
              defaultValue={data.billing_hora_generacion || '08:00'}
              className="input-field font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Ciclo de facturación por defecto
            </label>
            <select
              name="cicloFacturacion"
              defaultValue={data.billing_ciclo || 'mensual'}
              className="input-field"
            >
              <option value="mensual">Mensual</option>
              <option value="bimestral">Bimestral</option>
              <option value="trimestral">Trimestral</option>
              <option value="semestral">Semestral</option>
              <option value="anual">Anual</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Modo de precio
            </label>
            <select
              name="modoPrecio"
              defaultValue={data.billing_modo_precio || 'incluido'}
              className="input-field"
            >
              <option value="incluido">Precios incluyendo impuestos</option>
              <option value="excluido">Precios excluyendo impuestos</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Día de pago mensual predeterminado
            </label>
            <input
              name="defaultDiaPago"
              type="number"
              min="1"
              max="28"
              defaultValue={String(data.billing_default_dia_pago ?? 5)}
              className="input-field font-mono"
              placeholder="5"
            />
            <span className="text-[10px] text-muted-foreground block">
              Día del mes establecido por defecto para los cobros a nuevos clientes.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Días de gracia
            </label>
            <input
              name="defaultDiasGracia"
              type="number"
              min="0"
              defaultValue={String(data.billing_default_dias_gracia ?? 3)}
              className="input-field font-mono"
              placeholder="3"
            />
            <span className="text-[10px] text-muted-foreground block">
              Días adicionales concedidos para realizar el pago antes de recargos o suspensión del servicio.
            </span>
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
                <input name="autoAprobarEnviar" type="checkbox" defaultChecked={data.billing_auto_aprobar_enviar ?? true} className="sr-only peer" />
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
                <input name="detenerSuspendidos" type="checkbox" defaultChecked={data.billing_detener_suspendidos ?? true} className="sr-only peer" />
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
                    <input name="avisoNuevaFactura" type="checkbox" defaultChecked={data.billing_aviso_nueva_factura ?? true} className="sr-only peer" />
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
                    name="avisoPrevioDias"
                    type="number"
                    min="1"
                    defaultValue={String(data.billing_aviso_previo_dias ?? 5)}
                    className="input-field py-1 px-2 text-xs font-mono w-24"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer select-none flex-shrink-0">
                    <input name="recordatoriosPago" type="checkbox" defaultChecked={data.billing_recordatorios_pago ?? true} className="sr-only peer" />
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
                    name="recordatorioFrecuenciaDias"
                    type="number"
                    min="1"
                    defaultValue={String(data.billing_recordatorio_frecuencia_dias ?? 3)}
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
