import { User, CreditCard, Wifi } from 'lucide-react'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'

/** Tarjetas de datos personales, plan y facturación, y conectividad. */
export function ClientInfoGroups({ client }: { client: any }) {
  const dateFormat = useDateFormat()

  return (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 border-t border-border/50 pt-5 mt-2">
                {/* 1. Datos Personales */}
                <div className="glass-card p-4 border border-border/60 bg-secondary/5 space-y-4 font-sans">
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/30">
                    <User className="w-3.5 h-3.5" /> Información Personal
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Identificación:</span>
                      <span className="font-semibold text-foreground font-mono">{client.cedula}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Teléfono:</span>
                      <span className="font-semibold text-foreground">{client.phone}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Correo:</span>
                      <span className="font-semibold text-foreground break-all">{client.email || '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-border/20 gap-0.5">
                      <span className="text-muted-foreground">Dirección:</span>
                      <span className="font-semibold text-foreground leading-normal">{client.address}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">Fecha Registro:</span>
                      <span className="font-semibold text-foreground">{formatDate(client.created_at, dateFormat)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Plan y Facturación */}
                <div className="glass-card p-4 border border-border/60 bg-secondary/5 space-y-4 font-sans">
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/30">
                    <CreditCard className="w-3.5 h-3.5" /> Plan y Facturación
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Plan Contratado:</span>
                      <span className="font-bold text-brand-300">
                        {client.plan_activo?.name || 'Sin Plan'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Mensualidad:</span>
                      <span className="font-mono font-bold text-foreground">
                        ${Number(client.plan_activo?.price || 0).toFixed(2)}/mes
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Inicio Facturación:</span>
                      <span className="font-semibold text-foreground font-mono">
                        {client.billing_start ? formatDate(client.billing_start, dateFormat) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Ciclo:</span>
                      <span className="font-semibold text-foreground">
                        Día {client.billing_period_start_day || 1}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Tipo de Facturación:</span>
                      <span className="font-semibold text-foreground">
                        {client.billing_type === 'backward' ? 'Postpago' : 'Prepago'}
                      </span>
                    </div>
                    {client.custom_services && client.custom_services.length > 0 && (
                    <div className="flex flex-col py-1 gap-1">
                      <span className="text-muted-foreground">Servicios Adicionales:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(
                          client.custom_services.map((cs: any) => (
                            <span
                              key={cs.id}
                              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${
                                cs.recurring
                                  ? 'bg-brand-500/10 text-brand-400 border-brand-500/20'
                                  : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              }`}
                              title={cs.description || ''}
                            >
                              {cs.name} (${Number(cs.price).toFixed(2)})
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    )}
                  </div>
                </div>

                {/* 3. Conectividad y Red */}
                <div className="glass-card p-4 border border-border/60 bg-secondary/5 space-y-4 font-sans">
                  <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/30">
                    <Wifi className="w-3.5 h-3.5" /> Conectividad y Red
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Medio:</span>
                      <span className="font-semibold text-foreground">
                        {client.medium === 'radio' ? 'Radioenlace' : client.medium === 'fiber' ? 'Fibra óptica' : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Asignación de IP:</span>
                      <span className="font-semibold text-foreground uppercase">{client.access_method === 'static' ? 'IP Estática' : 'PPPoE'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Router:</span>
                      <span className="font-semibold text-foreground truncate max-w-[150px]">{client.router_name ?? '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/20">
                      <span className="text-muted-foreground">Sitio / Ubicación:</span>
                      <span className="font-semibold text-foreground font-sans">
                        {client.site_name ? (
                          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.2 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                            {client.site_name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </span>
                    </div>

                    {client.access_method === 'static' ? (
                      <>
                        <div className="flex justify-between py-1 border-b border-border/20">
                          <span className="text-muted-foreground">IP WAN:</span>
                          <span className="font-semibold text-foreground font-mono">{client.static_ip?.ip ?? 'No Asignada'}</span>
                        </div>
                        {client.static_ip?.notes && (
                          <div className="flex flex-col py-1 border-t border-border/20 mt-1 gap-0.5">
                            <span className="text-muted-foreground">Notas de IP:</span>
                            <span className="text-foreground leading-normal italic">{client.static_ip.notes}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between py-1 border-b border-border/20">
                          <span className="text-muted-foreground">Usuario PPPoE:</span>
                          <span className="font-semibold text-foreground font-mono">{client.pppoe_secret?.ppp_username ?? 'No Configurado'}</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-muted-foreground">Contraseña:</span>
                          <span className="font-semibold text-foreground font-mono">{client.pppoe_secret?.ppp_password ?? 'No Configurada'}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
  )
}
