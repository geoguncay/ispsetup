import { MapPinOff, Radio, Cable, Users, UserCheck, UserX } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { TOOLTIP_STYLE } from '@/pages/reports/shared'
import { SectionTitle, StatCard } from './StatCard'
import type { ClientsSummary } from './types'

const MEDIA: { key: 'radio' | 'fiber' | 'unspecified'; label: string; color: string }[] = [
  { key: 'radio', label: 'Radio', color: '#0ea5e9' },
  { key: 'fiber', label: 'Fibra', color: '#10b981' },
  { key: 'unspecified', label: 'Sin especificar', color: '#64748b' },
]

export function ClientsSection({ clients, loading }: { clients: ClientsSummary | undefined; loading: boolean }) {
  const total = clients?.total ?? 0
  const slices = MEDIA.map((m) => ({ ...m, value: clients?.by_medium[m.key] ?? 0 })).filter((m) => m.value > 0)

  return (
    <section>
      <SectionTitle>Clientes</SectionTitle>
      <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total clientes" value={total} icon={Users} tone="violet" to="/clients" loading={loading} />
        <StatCard
          label="Activos"
          value={clients?.active ?? 0}
          icon={UserCheck}
          tone="emerald"
          hint={clients ? `${clients.by_access_method.pppoe} PPPoE · ${clients.by_access_method.static} IP fija` : undefined}
          loading={loading}
        />
        <StatCard
          label="Suspendidos"
          value={clients?.suspended ?? 0}
          icon={UserX}
          tone="orange"
          hint={clients && clients.scheduled_suspensions > 0 ? `${clients.scheduled_suspensions} programadas` : undefined}
          loading={loading}
        />
        <StatCard
          label="Sin ubicación"
          value={clients?.without_location ?? 0}
          icon={MapPinOff}
          tone={clients && clients.without_location > 0 ? 'amber' : 'slate'}
          hint="No aparecen en los mapas"
          to="/clients"
          loading={loading}
        />
      </div>

      <div className="glass-card relative z-10 p-5 mt-4">
        <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Radio className="w-4 h-4 text-muted-foreground" />
          <Cable className="w-4 h-4 text-muted-foreground -ml-1" />
          Clientes por medio de acceso
        </h2>
        {loading || total === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            {loading ? 'Cargando…' : 'Aún no hay clientes registrados'}
          </p>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="h-44 w-44 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart accessibilityLayer={false}>
                  <Pie data={slices} dataKey="value" nameKey="label" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="none">
                    {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
                  </Pie>
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v} clientes`, name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full space-y-2">
              {MEDIA.map(({ key, label, color }) => {
                const n = clients?.by_medium[key] ?? 0
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-foreground">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                    <span className="text-muted-foreground">{n} · {((n / total) * 100).toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
