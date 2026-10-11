import { Activity, Loader2 } from 'lucide-react'
import TrafficChart from '@/components/charts/TrafficChart'
import type { LbInterface } from '../types'

interface TrafficTabProps {
  interfaces: LbInterface[]
  selectedChartInterface: string
  onChartInterfaceChange: (name: string) => void
  liveSeries: { timestamp: string; rx_rate: number; tx_rate: number }[]
}

export function TrafficTab({ interfaces, selectedChartInterface, onChartInterfaceChange, liveSeries }: TrafficTabProps) {
  return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand-400" />
              Interfaz a graficar
            </label>
            <select
              value={selectedChartInterface}
              onChange={(e) => onChartInterfaceChange(e.target.value)}
              className="input-field cursor-pointer w-auto text-sm"
            >
              <option value="__all__">Todas las interfaces (suma)</option>
              {interfaces.map((i) => <option key={i.name} value={i.name}>{i.name}</option>)}
            </select>
          </div>
          <div className="glass-card p-4">
            {liveSeries.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Esperando datos en vivo...
              </div>
            ) : (
              <TrafficChart data={liveSeries} range="live" height={300} />
            )}
          </div>
        </div>
  )
}
