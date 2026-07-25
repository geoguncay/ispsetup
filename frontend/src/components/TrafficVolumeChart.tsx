import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceArea,
} from 'recharts'
import { useTimeFormat } from '@/hooks/useDateFormat'
import { formatVolume } from '@/lib/traffic'

export interface TrafficVolumePoint {
  timestamp: string | Date | number
  download_bytes: number
  upload_bytes: number
  total_bytes: number
}

export interface TrafficGap {
  start: string
  end: string
}

interface TrafficVolumeChartProps {
  data: TrafficVolumePoint[]
  gaps?: TrafficGap[]
  range: '1h' | '24h' | '7d' | '30d' | 'custom'
  periodStart: string
  periodEnd: string
  height?: number | string
}

interface VolumeTooltipProps {
  active?: boolean
  payload?: Array<{
    payload: TrafficVolumePoint & { no_data?: boolean; timestamp_value: number }
  }>
  hour12: boolean
}

function VolumeTooltip({ active, payload, hour12 }: VolumeTooltipProps) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const date = new Date(point.timestamp)

  if (point.no_data) {
    return (
      <div className="glass-card rounded-xl border border-amber-500/30 p-3 text-xs shadow-xl">
        <p className="font-semibold text-amber-400"> del colector</p>
      </div>
    )
  }

  return (
    <div className="glass-card p-3 border border-border/40 rounded-xl text-xs space-y-1.5 shadow-xl">
      <p className="font-mono text-muted-foreground text-[10px] uppercase tracking-wider">
        {date.toLocaleString([], {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12,
        })}
      </p>
      <p className="flex justify-between gap-6 text-cyan-400">
        <span>Descargado</span>
        <strong className="font-mono text-foreground">{formatVolume(point.download_bytes)}</strong>
      </p>
      <p className="flex justify-between gap-6 text-violet-400">
        <span>Subido</span>
        <strong className="font-mono text-foreground">{formatVolume(point.upload_bytes)}</strong>
      </p>
      <p className="flex justify-between gap-6 pt-1 border-t border-border/40">
        <span>Total</span>
        <strong className="font-mono">{formatVolume(point.total_bytes)}</strong>
      </p>
    </div>
  )
}

export default function TrafficVolumeChart({
  data, gaps = [], range, periodStart, periodEnd, height = 300,
}: TrafficVolumeChartProps) {
  const hour12 = useTimeFormat() === '12H'
  const measuredPoints = data.map((point) => ({
    ...point,
    timestamp_value: new Date(point.timestamp).getTime(),
  }))
  // Un punto nulo dentro de cada interrupción obliga a Recharts a cortar
  // ambas áreas en vez de conectar las mediciones de los extremos.
  const gapBreakPoints = gaps.map((gap) => {
    const start = new Date(gap.start).getTime()
    const end = new Date(gap.end).getTime()
    const midpoint = start + ((end - start) / 2)
    return {
      timestamp: new Date(midpoint).toISOString(),
      timestamp_value: midpoint,
      download_bytes: null,
      upload_bytes: null,
      total_bytes: null,
      no_data: true,
    }
  })
  const chartData = [...measuredPoints, ...gapBreakPoints]
    .sort((a, b) => a.timestamp_value - b.timestamp_value)
  const domainStart = new Date(periodStart).getTime()
  // La API devuelve el límite final exclusivo; restar 1 ms evita rotular
  // el inicio de la siguiente hora o del siguiente día.
  const domainEnd = new Date(periodEnd).getTime() - 1

  const formatXAxis = (tick: number) => {
    const date = new Date(tick)
    if (Number.isNaN(date.getTime())) return String(tick)
    if (range === '1h' || range === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 })
    }
    return date.toLocaleDateString([], { day: '2-digit', month: 'short' })
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeDownload" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="volumeUpload" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,.05)" />
          <XAxis
            dataKey="timestamp_value"
            type="number"
            domain={[domainStart, domainEnd]}
            tickFormatter={formatXAxis}
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,.45)', fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            dy={8}
          />
          <YAxis
            width={72}
            tickFormatter={formatVolume}
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,.45)', fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<VolumeTooltip hour12={hour12} />} cursor={{ stroke: 'rgba(255,255,255,.1)' }} />
          {gaps.map((gap) => {
            const start = new Date(gap.start).getTime()
            const end = new Date(gap.end).getTime()
            const showLabel = end - start >= 120_000
            return (
              <ReferenceArea
                key={`${gap.start}-${gap.end}`}
                x1={start}
                x2={end}
                fill="#f59e0b"
                fillOpacity={0.08}
                stroke="#f59e0b"
                strokeOpacity={0.2}
                label={showLabel ? {
                  fill: '#fbbf24',
                  fontSize: 9,
                  position: 'insideTop',
                } : undefined}
              />
            )
          })}
          <Area
            type="monotone"
            dataKey="download_bytes"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#volumeDownload)"
            name="Descarga"
            connectNulls={false}
          />
          <Area
            type="monotone"
            dataKey="upload_bytes"
            stroke="#a78bfa"
            strokeWidth={2}
            fill="url(#volumeUpload)"
            name="Subida"
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
