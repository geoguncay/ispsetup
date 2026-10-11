import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import api from '@/services/api'
import TrafficChart from '@/components/charts/TrafficChart'
import TrafficVolumeChart from '@/components/charts/TrafficVolumeChart'
import { formatVolume } from '@/lib/traffic'

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface TrafficTabProps {
  clientId: string | undefined
  routerId: string | null | undefined
}

/** Tráfico del cliente: en vivo (WebSocket) o histórico por rango. */
export function TrafficTab({ clientId: id, routerId }: TrafficTabProps) {
  const [trafficRange, setTrafficRange] = useState<'live' | '1h' | '24h' | '7d' | '30d' | 'custom'>('live')
  const [trafficPeriodMode, setTrafficPeriodMode] = useState<'calendar' | 'rolling'>('calendar')
  const [liveTraffic, setLiveTraffic] = useState<any[]>([])
  const [customTrafficStart, setCustomTrafficStart] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return toDateInputValue(date)
  })
  const [customTrafficEnd, setCustomTrafficEnd] = useState(() => toDateInputValue(new Date()))

  const { data: historicalTraffic = null, isLoading: isLoadingHistorical } = useQuery({
    queryKey: [
      'client-traffic-historical', id, trafficRange, trafficPeriodMode,
      customTrafficStart, customTrafficEnd,
    ],
    queryFn: async () => {
      const params: Record<string, string> = {
        range: trafficRange,
        period_mode: trafficPeriodMode,
      }
      if (trafficRange === 'custom') {
        const start = new Date(`${customTrafficStart}T00:00:00`)
        const endInclusive = new Date(`${customTrafficEnd}T00:00:00`)
        endInclusive.setDate(endInclusive.getDate() + 1)
        params.start = start.toISOString()
        params.end = endInclusive.toISOString()
      }
      const { data } = await api.get(`/traffic/client/${id}`, {
        params
      })
      return data
    },
    enabled: trafficRange !== 'live' && (
      trafficRange !== 'custom' ||
      Boolean(customTrafficStart && customTrafficEnd && customTrafficStart <= customTrafficEnd)
    ),
    refetchInterval: trafficRange === 'live' ? false : 30_000,
  })

  useEffect(() => {
    if (trafficRange !== 'live' || !routerId) return

    const wsUrl = (() => {
      const token = localStorage.getItem('access_token') || ''
      const apiHost = import.meta.env.VITE_API_URL
      let wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      let wsHost = window.location.host
      if (apiHost) {
        try {
          const url = new URL(apiHost)
          wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
          wsHost = url.host
        } catch {}
      }
      return `${wsProtocol}//${wsHost}/api/traffic/ws/${routerId}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const timestamp = payload.timestamp
        const clients = payload.clients || []
        const mySample = clients.find((c: any) => c.client_id === id)

        setLiveTraffic((prev) => {
          const newPoint = {
            timestamp,
            rx_rate: mySample ? mySample.rx_rate : 0,
            tx_rate: mySample ? mySample.tx_rate : 0,
          }
          const nextPoints = [...prev, newPoint]
          return nextPoints.length > 30 ? nextPoints.slice(nextPoints.length - 30) : nextPoints
        })
      } catch (err) {
        console.error("Error en WebSocket de tráfico de cliente:", err)
      }
    }

    return () => {
      ws.close()
    }
  }, [id, routerId, trafficRange])

  return (
                <div className="space-y-6 font-sans animate-fade-in">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {trafficRange === 'live' ? 'Tráfico en vivo' : 'Volumen consumido'}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {trafficRange === 'live'
                          ? 'Velocidad actual de subida y descarga del cliente.'
                          : 'Datos descargados y subidos durante el período seleccionado.'}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {trafficRange !== 'live' && trafficRange !== 'custom' && (
                        <div className="flex bg-secondary/30 p-0.5 rounded-lg border border-border/40">
                          {[
                            { id: 'calendar', label: 'Calendario' },
                            { id: 'rolling', label: 'Ventana móvil' },
                          ].map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => setTrafficPeriodMode(mode.id as 'calendar' | 'rolling')}
                              className={`text-[10px] px-2.5 py-1 rounded-md font-semibold transition-all ${
                                trafficPeriodMode === mode.id
                                  ? 'bg-primary text-primary-foreground shadow'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Selector de Rango */}
                      <div className="flex flex-wrap justify-end bg-secondary/30 p-0.5 rounded-lg border border-border/40">
                      {[
                        { id: 'live', label: 'En Vivo' },
                        { id: '1h', label: trafficPeriodMode === 'calendar' ? 'Hora' : 'Última hora' },
                        { id: '24h', label: trafficPeriodMode === 'calendar' ? 'Día' : '24 Horas' },
                        { id: '7d', label: trafficPeriodMode === 'calendar' ? 'Semana' : '7 Días' },
                        { id: '30d', label: trafficPeriodMode === 'calendar' ? 'Mes' : '30 Días' },
                        { id: 'custom', label: 'Personalizado' },
                      ].map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setTrafficRange(r.id as any)
                            if (r.id === 'live') {
                              setLiveTraffic([])
                            }
                          }}
                          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${
                            trafficRange === r.id
                              ? 'bg-primary text-primary-foreground shadow'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                      </div>
                    </div>
                  </div>

                  {trafficRange === 'custom' && (
                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/40 bg-secondary/10 p-4">
                      <label className="space-y-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Desde</span>
                        <input
                          type="date"
                          value={customTrafficStart}
                          max={customTrafficEnd}
                          onChange={(event) => setCustomTrafficStart(event.target.value)}
                          className="input-field h-9 py-1.5 text-xs"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Hasta</span>
                        <input
                          type="date"
                          value={customTrafficEnd}
                          min={customTrafficStart}
                          onChange={(event) => setCustomTrafficEnd(event.target.value)}
                          className="input-field h-9 py-1.5 text-xs"
                        />
                      </label>
                      <p className="pb-2 text-[10px] text-muted-foreground">Máximo 366 días. La fecha final se incluye completa.</p>
                    </div>
                  )}

                  {trafficRange === 'live' ? (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 min-h-[300px]">
                      {liveTraffic.length === 0 ? (
                        <div className="h-[300px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                          <p className="text-xs font-medium">Esperando datos del colector...</p>
                        </div>
                      ) : (
                        <TrafficChart data={liveTraffic} range="live" height={300} />
                      )}
                    </div>
                  ) : isLoadingHistorical ? (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 h-[340px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                      <p className="text-xs font-medium">Cargando datos históricos...</p>
                    </div>
                  ) : !historicalTraffic || !historicalTraffic.samples || (
                    historicalTraffic.samples.length === 0 &&
                    (!historicalTraffic.gaps || historicalTraffic.gaps.length === 0)
                  ) ? (
                    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 h-[340px] flex flex-col items-center justify-center text-muted-foreground text-center">
                      <p className="text-sm font-medium">No se encontraron estadísticas de tráfico para el rango seleccionado.</p>
                      <p className="text-xs text-muted-foreground mt-1">El colector podría no tener suficientes datos almacenados.</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Descargado</p>
                          <p className="mt-1 font-mono text-lg font-bold text-cyan-400">
                            {formatVolume(historicalTraffic.totals.download_bytes)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Subido</p>
                          <p className="mt-1 font-mono text-lg font-bold text-violet-400">
                            {formatVolume(historicalTraffic.totals.upload_bytes)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/40 bg-secondary/10 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Consumo total</p>
                          <p className="mt-1 font-mono text-lg font-bold text-foreground">
                            {formatVolume(historicalTraffic.totals.total_bytes)}
                          </p>
                        </div>
                      </div>
                      <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 min-h-[300px]">
                        <TrafficVolumeChart
                          data={historicalTraffic.samples}
                          gaps={historicalTraffic.gaps}
                          range={trafficRange}
                          periodStart={historicalTraffic.start}
                          periodEnd={historicalTraffic.end}
                          height={300}
                        />
                        {historicalTraffic.gaps?.length > 0 && (
                          <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-amber-400">
                            <span className="h-2.5 w-4 rounded-sm border border-amber-500/30 bg-amber-500/10" />
                            Sin datos
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
  )
}
