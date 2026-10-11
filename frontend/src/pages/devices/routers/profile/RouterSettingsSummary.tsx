import { Settings2, Network, Sliders } from 'lucide-react'
import { SECURITY_MODE_LABELS, TRAFFIC_ACCOUNTING_LABELS, SPEED_CONTROL_LABELS } from './labels'

interface RouterSettingsSummaryProps {
  router: any
  isAdmin: boolean
  onOpenSettings: () => void
}

/** Resumen de la configuración operativa aplicada al router. */
export function RouterSettingsSummary({ router, isAdmin, onOpenSettings }: RouterSettingsSummaryProps) {
  const hasServiceConfig = router.settings_configured === true

  return (
          <div className={`glass-card border p-4 ${hasServiceConfig ? 'border-border/40' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Seguridad',
                    value: SECURITY_MODE_LABELS[router.security_mode] ?? 'Pendiente',
                    icon: Settings2,
                  },
                  {
                    label: 'Registro de tráfico',
                    value: TRAFFIC_ACCOUNTING_LABELS[router.traffic_accounting] ?? 'Pendiente',
                    icon: Network,
                  },
                  {
                    label: 'Control de velocidad',
                    value: SPEED_CONTROL_LABELS[router.speed_control_type] ?? 'Pendiente',
                    icon: Sliders,
                  },
                ].map((setting) => {
                  const Icon = setting.icon
                  return (
                    <div key={setting.label} className="flex min-w-0 items-center gap-2.5">
                      <div className="rounded-lg bg-brand-500/10 p-2 text-brand-400">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {setting.label}
                        </span>
                        <span className="block truncate text-xs font-semibold text-foreground" title={setting.value}>
                          {setting.value}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {isAdmin && (
                <button type="button" onClick={onOpenSettings} className="btn-secondary shrink-0 text-xs">
                  <Settings2 className="h-3.5 w-3.5" />
                  {hasServiceConfig ? 'Modificar ajustes' : 'Completar ajustes'}
                </button>
              )}
            </div>
            {!hasServiceConfig && (
              <p className="mt-3 border-t border-amber-500/20 pt-3 text-xs text-amber-400">
                Completa los ajustes operativos. Los clientes y el historial siguen disponibles mientras tanto.
              </p>
            )}
          </div>
  )
}
