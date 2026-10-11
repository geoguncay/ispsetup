import { useNavigate } from 'react-router-dom'
import { Users, Loader2 } from 'lucide-react'
import { formatSpeed } from '@/components/charts/TrafficChart'
import { DonutChart } from '../DonutChart'
import { formatBytes } from '../format'
import type { Client } from '../types'

interface StatsTabProps {
  allClients: Client[]
  liveClients: any[]
  bridgeBytes: { rx: number; tx: number } | null
}

export function StatsTab({ allClients, liveClients, bridgeBytes }: StatsTabProps) {
  const navigate = useNavigate()

  const activeClients = allClients.filter((c) => c.active).length
  const inactiveClients = allClients.length - activeClients
  const totalClients = allClients.length
  const activePercentage = totalClients > 0 ? (activeClients / totalClients) * 100 : 0

  const totalRxBytes = bridgeBytes?.rx ?? 0
  const totalTxBytes = bridgeBytes?.tx ?? 0
  const totalBytes = totalRxBytes + totalTxBytes
  const rxBytesPct = totalBytes > 0 ? (totalRxBytes / totalBytes) * 100 : 50

  return (
            <div className="space-y-6">
              {/* Doughnut charts grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <DonutChart
                  percentage={activePercentage}
                  title="Distribución de Clientes"
                  label1="Activos"
                  val1={activeClients}
                  color1="#10b981"
                  label2="Suspendidos"
                  val2={inactiveClients}
                  color2="#f59e0b"
                  centerLabel={`${Math.round(activePercentage)}%`}
                  centerSublabel="Activos"
                />

                <DonutChart
                  percentage={rxBytesPct}
                  title="Tráfico Total"
                  label1="Descargado"
                  val1={formatBytes(totalRxBytes)}
                  color1="#3b82f6"
                  label2="Subido"
                  val2={formatBytes(totalTxBytes)}
                  color2="#a835f7"
                  centerLabel={formatBytes(totalBytes)}
                  centerSublabel="Total"
                />
              </div>

              {/* Top 10 Clientes Activos por Consumo */}
              <div className="glass-card p-5 border border-border/40 space-y-4 font-sans">
                <h3 className="text-sm font-semibold text-foreground border-b border-border/40 pb-2.5 flex items-center gap-2">
                  <Users className="w-4 h-4 text-brand-400" />
                  Top 10 Clientes Activos
                </h3>

                {liveClients.length === 0 ? (
                  <p className="text-center py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                    Cargando ranking de consumo en vivo...
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Cliente</th>
                          <th>Tasa Descarga (RX)</th>
                          <th>Tasa Subida (TX)</th>
                          <th>Consumo Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liveClients.slice(0, 10).map((lc: any) => (
                          <tr
                            key={lc.client_id}
                            onClick={() => navigate(`/clients/${lc.client_id}`)}
                            className="hover:bg-secondary/40 cursor-pointer transition-colors"
                          >
                            <td className="font-semibold text-sm text-foreground">
                              {lc.name}
                            </td>
                            <td className="font-mono text-xs text-cyan-400 font-bold">
                              {formatSpeed(lc.rx_rate)}
                            </td>
                            <td className="font-mono text-xs text-violet-400 font-bold">
                              {formatSpeed(lc.tx_rate)}
                            </td>
                            <td className="font-mono text-xs text-muted-foreground">
                              {formatBytes(lc.rx_bytes + lc.tx_bytes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
  )
}
