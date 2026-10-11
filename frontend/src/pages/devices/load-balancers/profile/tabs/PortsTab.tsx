import { Network } from 'lucide-react'
import { formatSpeed } from '@/components/charts/TrafficChart'
import { formatBytes } from '@/pages/devices/shared/formatBytes'
import { PortStatusBadge } from '../PortStatusBadge'
import type { LbInterface } from '../types'

export function PortsTab({ interfaces }: { interfaces: LbInterface[] }) {
  return (
        <div className="glass-card overflow-x-auto">
          {interfaces.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-2 text-muted-foreground/60" />
              Aún no hay datos de interfaces. El sondeo corre cada 5 segundos.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Interfaz</th>
                  <th>Estado</th>
                  <th>Descarga (RX)</th>
                  <th>Subida (TX)</th>
                  <th>Consumo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {interfaces.map((iface) => (
                  <tr key={iface.name}>
                    <td className="font-mono text-sm font-semibold text-foreground">{iface.name}</td>
                    <td><PortStatusBadge running={iface.running} disabled={iface.disabled} /></td>
                    <td className="font-mono text-xs text-cyan-400 font-bold">{formatSpeed(iface.rx_rate)}</td>
                    <td className="font-mono text-xs text-violet-400 font-bold">{formatSpeed(iface.tx_rate)}</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      ↓ {formatBytes(iface.rx_bytes)} / ↑ {formatBytes(iface.tx_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
  )
}
