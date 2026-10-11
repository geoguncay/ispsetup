import { Antenna, Link2, RadioTower, Waypoints } from 'lucide-react'
import { SectionTitle, StatCard } from './StatCard'
import type { NetworkSummary } from './types'

export function NetworkSection({ network, loading }: { network: NetworkSummary | undefined; loading: boolean }) {
  return (
    <section>
      <SectionTitle>Red de radio</SectionTitle>
      <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Puntos de acceso" value={network?.access_points ?? 0} icon={RadioTower} tone="sky" to="/maps/radio" loading={loading} />
        <StatCard label="Estaciones" value={network?.stations ?? 0} icon={Antenna} tone="violet" to="/maps/radio" loading={loading} />
        <StatCard label="Enlaces PtP" value={network?.ptp_links ?? 0} icon={Link2} tone="brand" to="/maps/radio" loading={loading} />
        <StatCard label="Enlaces PtMP" value={network?.ptmp_links ?? 0} icon={Waypoints} tone="emerald" to="/maps/radio" loading={loading} />
      </div>
    </section>
  )
}
