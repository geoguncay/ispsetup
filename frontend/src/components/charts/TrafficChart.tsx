import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Activity } from 'lucide-react'
import { useTimeFormat } from '@/hooks/useDateFormat'

export interface TrafficDataPoint {
  timestamp: string | Date | number
  rx_rate: number // download in bps
  tx_rate: number // upload in bps
}

interface TrafficChartProps {
  data: TrafficDataPoint[]
  range: 'live' | '1h' | '24h' | '7d' | '30d'
  height?: number | string
}

export const formatSpeed = (bps: number) => {
  if (bps === 0) return '0 bps'
  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  }
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(1)} Mbps`
  }
  if (bps >= 1_000) {
    return `${(bps / 1_000).toFixed(0)} Kbps`
  }
  return `${bps.toFixed(0)} bps`
}

const YAxisTick = ({ x, y, payload }: any) => {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={3}
        textAnchor="end"
        fill="rgba(255, 255, 255, 0.45)"
        fontSize={9}
        fontFamily="monospace"
      >
        <tspan>{formatSpeed(Number(payload.value))}</tspan>
      </text>
    </g>
  )
}

export default function TrafficChart({ data, range, height = 300 }: TrafficChartProps) {
  const timeFormat = useTimeFormat()
  const hour12 = timeFormat === '12H'

  const formatXAxis = (tick: any) => {
    try {
      const date = new Date(tick)
      if (isNaN(date.getTime())) return tick
      if (range === 'live') {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12 })
      }
      if (range === '1h' || range === '24h') {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 })
      }
      return date.toLocaleDateString([], { day: '2-digit', month: 'short' })
    } catch {
      return tick
    }
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const rx = payload.find((p: any) => p.dataKey === 'rx_rate')?.value ?? 0
      const tx = payload.find((p: any) => p.dataKey === 'tx_rate')?.value ?? 0
      const ts = payload[0].payload.timestamp

      let formattedDate = ''
      try {
        const date = new Date(ts)
        if (!isNaN(date.getTime())) {
          formattedDate = date.toLocaleString([], {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: range === 'live' ? '2-digit' : undefined,
            hour12,
          })
        } else {
          formattedDate = String(ts)
        }
      } catch {
        formattedDate = String(ts)
      }

      return (
        <div className="glass-card p-3 border border-border/40 backdrop-blur-md rounded-xl text-xs space-y-1.5 shadow-xl animate-fade-in">
          <p className="font-mono text-muted-foreground text-[10px] uppercase tracking-wider">{formattedDate}</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                Descarga (RX)
              </span>
              <span className="font-mono font-bold text-foreground">{formatSpeed(rx)}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-violet-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-violet-400"></span>
                Subida (TX)
              </span>
              <span className="font-mono font-bold text-foreground">{formatSpeed(tx)}</span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="relative w-full h-full min-h-[180px] font-sans">
      {range === 'live' && (
        <div className="absolute top-2 right-4 z-10 flex items-center gap-1.5 text-[10px] font-bold text-cyan-400 uppercase tracking-widest bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/25">
          <Activity className="w-3 h-3 animate-pulse text-cyan-400" />
          <span className="relative flex h-1.5 w-1.5 mr-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
          </span>
          En vivo
        </div>
      )}

      <div style={{ width: '100%', height: height }}>
        <ResponsiveContainer>
          <AreaChart
            data={data}
            margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="rgba(255, 255, 255, 0.05)"
            />

            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              stroke="rgba(255, 255, 255, 0.3)"
              tick={{ fontSize: 9, fill: 'rgba(255, 255, 255, 0.45)', fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              dy={8}
            />

            <YAxis
              width={72}
              tickFormatter={formatSpeed}
              tick={<YAxisTick />}
              tickMargin={8}
              stroke="rgba(255, 255, 255, 0.3)"
              tickLine={false}
              axisLine={false}
              dx={-4}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255, 255, 255, 0.1)' }} />

            <Area
              type="monotone"
              dataKey="rx_rate"
              stroke="#22d3ee"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorRx)"
              name="Descarga"
            />

            <Area
              type="monotone"
              dataKey="tx_rate"
              stroke="#a78bfa"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorTx)"
              name="Subida"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
