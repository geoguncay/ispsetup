/**
 * TrafficPage — Monitoreo de tráfico de red en tiempo real.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Activity, Server, ArrowDown, ArrowUp, Users, Search,
  RefreshCw, RefreshCcw, ShieldAlert, ExternalLink
} from 'lucide-react'
import api from '@/services/api'
import TrafficChart, { formatSpeed } from '@/components/TrafficChart'
import { GatewayStatusBadge } from '@/components/GatewayStatusBadge'

interface Gateway {
  id: string
  name: string
  ip: string
  active: boolean
  status: 'online' | 'offline' | 'degraded' | 'unknown' | null
}

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

const getIntervalSeconds = (range: string) => {
  switch (range) {
    case '1h': return 60
    case '24h': return 300
    case '7d': return 3600
    case '30d': return 14400
    case 'live': return 2
    default: return 2
  }
}

const calculateTotalVolume = (samples: any[], range: string) => {
  if (!samples || samples.length === 0) return 0
  const interval = getIntervalSeconds(range)
  const totalBits = samples.reduce((acc, point) => acc + (point.rx_rate || 0), 0)
  return (totalBits * interval) / 8
}

const calculateAverageSpeed = (samples: any[]) => {
  if (!samples || samples.length === 0) return 0
  const sum = samples.reduce((acc, point) => acc + (point.rx_rate || 0), 0)
  return sum / samples.length
}

const calculateAverageUploadSpeed = (samples: any[]) => {
  if (!samples || samples.length === 0) return 0
  const sum = samples.reduce((acc, point) => acc + (point.tx_rate || 0), 0)
  return sum / samples.length
}

export function TrafficPage() {
  const navigate = useNavigate()

  // ── Router Selector States ──
  const [selectedGatewayId, setSelectedGatewayId] = useState<string>('')
  const [liveTraffic, setLiveTraffic] = useState<any[]>([])
  const [liveClients, setLiveClients] = useState<any[]>([])
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'idle'>('idle')
  const [searchTerm, setSearchTerm] = useState('')
  const [timeframe, setTimeframe] = useState<'live' | '1h' | '24h' | '7d' | '30d'>('live')

  // ── Fetch Routers ──
  const { data: gateways = [], isLoading: isLoadingGateways, refetch: refetchGateways } = useQuery<Gateway[]>({
    queryKey: ['gateways'],
    queryFn: async () => {
      const { data } = await api.get('/gateways')
      return data
    },
  })

  // ── Fetch Router Traffic History ──
  const { data: historyTraffic = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ['gateway-traffic-history', selectedGatewayId, timeframe],
    queryFn: async () => {
      if (timeframe === 'live' || !selectedGatewayId) return []
      const { data } = await api.get(`/traffic/gateway/${selectedGatewayId}?range=${timeframe}`)
      return data
    },
    enabled: timeframe !== 'live' && !!selectedGatewayId,
  })

  const selectedGateway = useMemo(() => {
    return gateways.find(r => r.id === selectedGatewayId)
  }, [gateways, selectedGatewayId])

  // Automatically select the first online router if none is selected
  useEffect(() => {
    if (gateways.length > 0 && !selectedGatewayId) {
      const firstOnline = gateways.find(r => r.status === 'online')
      if (firstOnline) {
        setSelectedGatewayId(firstOnline.id)
      } else {
        setSelectedGatewayId(gateways[0].id)
      }
    }
  }, [gateways, selectedGatewayId])

  // ── WebSocket live traffic connection ──
  useEffect(() => {
    if (!selectedGatewayId) {
      setLiveTraffic([])
      setLiveClients([])
      setWsStatus('idle')
      return
    }

    setWsStatus('connecting')
    setLiveTraffic([])
    setLiveClients([])

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
        } catch { }
      }
      return `${wsProtocol}//${wsHost}/api/traffic/ws/${selectedGatewayId}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setWsStatus('connected')
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const timestamp = payload.timestamp || new Date().toISOString()
        const clients = payload.clients || []

        // Calculate aggregate speeds from active clients
        const totalRx = clients.reduce((acc: number, c: any) => acc + (c.rx_rate || 0), 0)
        const totalTx = clients.reduce((acc: number, c: any) => acc + (c.tx_rate || 0), 0)

        // Store live trends
        setLiveTraffic((prev) => {
          const newPoint = {
            timestamp,
            rx_rate: totalRx,
            tx_rate: totalTx,
          }
          const nextPoints = [...prev, newPoint]
          // Keep last 30 data points
          return nextPoints.length > 30 ? nextPoints.slice(nextPoints.length - 30) : nextPoints
        })

        // Sort clients by speed (RX + TX desc)
        const sortedClients = [...clients].sort((a: any, b: any) =>
          ((b.rx_rate || 0) + (b.tx_rate || 0)) - ((a.rx_rate || 0) + (a.tx_rate || 0))
        )
        setLiveClients(sortedClients)
      } catch (err) {
        console.error('Error al procesar mensaje de tráfico en vivo:', err)
      }
    }

    ws.onclose = () => {
      setWsStatus('disconnected')
    }

    ws.onerror = () => {
      setWsStatus('disconnected')
    }

    return () => {
      ws.close()
    }
  }, [selectedGatewayId])

  // Filter clients list
  const filteredClients = useMemo(() => {
    return liveClients.filter(client =>
      client.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [liveClients, searchTerm])

  // Get current totals
  const currentTotals = useMemo(() => {
    if (liveTraffic.length === 0) return { rx: 0, tx: 0 }
    const latest = liveTraffic[liveTraffic.length - 1]
    return {
      rx: latest.rx_rate,
      tx: latest.tx_rate
    }
  }, [liveTraffic])

  const metrics = useMemo(() => {
    if (timeframe === 'live') {
      const latest = liveTraffic.length > 0 ? liveTraffic[liveTraffic.length - 1] : { rx_rate: 0, tx_rate: 0 }
      const totalVolume = calculateTotalVolume(liveTraffic, 'live')
      return {
        rx: latest.rx_rate,
        tx: latest.tx_rate,
        volume: totalVolume,
        isLive: true,
      }
    } else {
      const avgRx = calculateAverageSpeed(historyTraffic)
      const avgTx = calculateAverageUploadSpeed(historyTraffic)
      const totalVolume = calculateTotalVolume(historyTraffic, timeframe)
      return {
        rx: avgRx,
        tx: avgTx,
        volume: totalVolume,
        isLive: false,
      }
    }
  }, [timeframe, liveTraffic, historyTraffic])

  if (isLoadingGateways) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span>Cargando gateways para monitoreo...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-cyan-400" />
            Monitoreo de Tráfico
          </h1>
        </div>

        {/* Router Selector */}
        <div className="flex items-center gap-3">
          <Server className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <select
            value={selectedGatewayId}
            onChange={(e) => setSelectedGatewayId(e.target.value)}
            className="input-field max-w-[240px] cursor-pointer"
          >
            <option value="">-- Seleccionar Router --</option>
            {gateways.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name} ({router.status === 'online' ? 'En línea' : 'Desconectado'})
              </option>
            ))}
          </select>

          <button
            onClick={() => refetchGateways()}
            className="btn-secondary p-2.5"
            title="Actualizar lista de gateways"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Empty State */}
      {!selectedGatewayId ? (
        <div className="glass-card p-12 text-center max-w-xl mx-auto mt-12 space-y-4">
          <div className="w-16 h-16 bg-cyan-500/10 rounded-full flex items-center justify-center mx-auto border border-cyan-500/25">
            <Activity className="w-8 h-8 text-cyan-400 animate-pulse" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Ningún Router Seleccionado</h3>
          <p className="text-muted-foreground text-sm">
            Para iniciar el monitoreo de tráfico en tiempo real, selecciona uno de los gateways activos en la esquina superior derecha.
          </p>
        </div>
      ) : (
        <>
          {/* Connection Status Banner */}
          {wsStatus === 'connecting' && (
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-4 flex items-center gap-3 text-cyan-400 text-sm font-medium">
              <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>Conectando con el colector de tráfico del router {selectedGateway?.name}...</span>
            </div>
          )}
          {wsStatus === 'disconnected' && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3 text-red-400 text-sm font-medium">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>Conexión perdida con el router. Intentando reconectar automáticamente...</span>
            </div>
          )}

          {/* ── Real-time Stats Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Total Download */}
            <div className="glass-card p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Descarga Agregada (RX)</p>
                <p className="text-2xl font-bold text-cyan-400 font-mono mt-1">
                  {formatSpeed(currentTotals.rx)}
                </p>
              </div>
              <div className="w-10 h-10 bg-cyan-500/10 rounded-xl flex items-center justify-center border border-cyan-500/20">
                <ArrowDown className="w-5 h-5 text-cyan-400 animate-bounce" />
              </div>
            </div>

            {/* Total Upload */}
            <div className="glass-card p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium font-sans">Subida Agregada (TX)</p>
                <p className="text-2xl font-bold text-violet-400 font-mono mt-1">
                  {formatSpeed(currentTotals.tx)}
                </p>
              </div>
              <div className="w-10 h-10 bg-violet-500/10 rounded-xl flex items-center justify-center border border-violet-500/20">
                <ArrowUp className="w-5 h-5 text-violet-400 animate-bounce" />
              </div>
            </div>

            {/* Active clients */}
            <div className="glass-card p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Clientes con Tráfico</p>
                <p className="text-2xl font-bold text-emerald-400 font-mono mt-1">
                  {liveClients.filter(c => (c.rx_rate > 1000 || c.tx_rate > 1000)).length}
                </p>
              </div>
              <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                <Users className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
          </div>

          {/* ── Chart Section ── */}
          <div className="glass-card p-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Ancho de Banda Total (Clientes Activos)
                  </h2>
                  {timeframe === 'live' && wsStatus === 'connected' && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-medium animate-fade-in">
                      <span className="relative flex h-1.5 w-1.5 mr-0.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                      </span>
                      En vivo
                    </div>
                  )}
                </div>

                {/* dynamic metrics pills row */}
                <div className="flex items-center gap-3 mt-1 text-[11px] flex-wrap font-sans">
                  <div className="flex items-center gap-1 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-lg text-cyan-400 font-semibold shadow-inner">
                    <ArrowDown className="w-3 h-3 flex-shrink-0" />
                    <span className="text-muted-foreground text-[9px] uppercase font-sans tracking-wide">Descarga{metrics.isLive ? '' : ' Prom'}:</span>
                    <span className="font-mono">{formatSpeed(metrics.rx)}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-lg text-violet-400 font-semibold shadow-inner">
                    <ArrowUp className="w-3 h-3 flex-shrink-0" />
                    <span className="text-muted-foreground text-[9px] uppercase font-sans tracking-wide">Subida{metrics.isLive ? '' : ' Prom'}:</span>
                    <span className="font-mono">{formatSpeed(metrics.tx)}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg text-emerald-400 font-semibold shadow-inner">
                    <Activity className="w-3 h-3 flex-shrink-0" />
                    <span className="text-muted-foreground text-[9px] uppercase font-sans tracking-wide">Vol. Descargado:</span>
                    <span className="font-mono">{formatBytes(metrics.volume)}</span>
                  </div>
                </div>
              </div>

              {/* Timeframe Selector and WebSocket Status */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 self-start lg:self-auto">
                {timeframe === 'live' && (
                  <div className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-border bg-background/30 flex items-center gap-1.5 shadow-sm">
                    <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                      wsStatus === 'connecting' ? 'bg-cyan-500 animate-pulse' :
                        'bg-red-500'
                      }`} />
                    <span className="text-muted-foreground uppercase text-[9px] tracking-wider font-sans">
                      {wsStatus === 'connected' ? 'Conectado' :
                        wsStatus === 'connecting' ? 'Conectando...' :
                          'Desconectado'}
                    </span>
                  </div>
                )}

                <div className="flex bg-background/40 border border-border/50 rounded-xl p-0.5 backdrop-blur-sm shadow-inner">
                  {[
                    { value: 'live', label: 'En vivo' },
                    { value: '1h', label: '1 hora' },
                    { value: '24h', label: '24 horas' },
                    { value: '7d', label: '7 días' },
                    { value: '30d', label: '30 días' },
                  ].map((tf) => (
                    <button
                      key={tf.value}
                      type="button"
                      onClick={() => setTimeframe(tf.value as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${timeframe === tf.value
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/25'
                        }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-secondary/15 p-4 rounded-xl border border-border/40 min-h-[300px] flex flex-col justify-center">
              {timeframe === 'live' && liveTraffic.length === 0 ? (
                <div className="h-[300px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <p className="text-xs font-medium">Esperando primeras muestras del router...</p>
                </div>
              ) : timeframe !== 'live' && isLoadingHistory ? (
                <div className="h-[300px] flex flex-col items-center justify-center gap-3 text-muted-foreground animate-fade-in">
                  <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                  <p className="text-xs font-medium">Cargando historial de tráfico...</p>
                </div>
              ) : timeframe !== 'live' && historyTraffic.length === 0 ? (
                <div className="h-[300px] flex flex-col items-center justify-center gap-3 text-muted-foreground text-center animate-fade-in">
                  <p className="text-xs font-medium">No hay registros de tráfico para este período.</p>
                </div>
              ) : (
                <TrafficChart
                  data={timeframe === 'live' ? liveTraffic : historyTraffic}
                  range={timeframe}
                  height={300}
                />
              )}
            </div>
          </div>

          {/* ── Detail Grid: Active Clients ── */}
          <div className="w-full">
            {/* Active Clients Card (Full width) */}
            <div className="glass-card p-5 flex flex-col h-[520px]">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/50 pb-3 mb-4 flex-shrink-0">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  Top Clientes Activos
                </h3>
                {/* Search Bar */}
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar cliente..."
                    className="input-field pl-9 pr-4 py-1.5 text-xs font-sans w-full"
                  />
                </div>
              </div>

              {/* Table of active clients */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {filteredClients.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs py-12 space-y-1.5">
                    <Search className="w-6 h-6 text-muted-foreground/50" />
                    <span>No se encontraron clientes activos con telemetría</span>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead className="sticky top-0 bg-card/95 backdrop-blur-md z-10">
                      <tr>
                        <th className="text-left">Cliente</th>
                        <th className="!text-right">Descarga (RX)</th>
                        <th className="!text-right">Subida (TX)</th>
                        <th className="hidden sm:table-cell !text-right">Vol. Descarga</th>
                        <th className="hidden sm:table-cell !text-right">Vol. Subida</th>
                        <th className="hidden sm:table-cell !text-right">Vol. Total</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClients.map((client) => {
                        const totalBytes = (client.rx_bytes || 0) + (client.tx_bytes || 0)
                        const isTransmitting = (client.rx_rate > 1000 || client.tx_rate > 1000)

                        return (
                          <tr key={client.client_id} className="hover:bg-secondary/20 transition-colors group">
                            <td>
                              <div className="flex items-center gap-2.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${isTransmitting ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground text-sm truncate max-w-[180px] sm:max-w-[240px]">
                                    {client.name}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="!text-right font-mono text-cyan-400 font-semibold">
                              <span className="flex items-center justify-end gap-1 text-xs w-full">
                                <ArrowDown className="w-3 h-3 flex-shrink-0" />
                                {formatSpeed(client.rx_rate || 0)}
                              </span>
                            </td>
                            <td className="!text-right font-mono text-violet-400 font-semibold font-sans">
                              <span className="flex items-center justify-end gap-1 text-xs w-full">
                                <ArrowUp className="w-3 h-3 flex-shrink-0" />
                                {formatSpeed(client.tx_rate || 0)}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell !text-right font-mono text-muted-foreground text-xs">
                              {formatBytes(client.rx_bytes || 0)}
                            </td>
                            <td className="hidden sm:table-cell !text-right font-mono text-muted-foreground text-xs">
                              {formatBytes(client.tx_bytes || 0)}
                            </td>
                            <td className="hidden sm:table-cell !text-right font-mono text-muted-foreground text-xs">
                              {formatBytes(totalBytes)}
                            </td>
                            <td>
                              <button
                                onClick={() => navigate(`/clients/${client.client_id}`)}
                                className="group-hover:opacity-100 p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-all"
                                title="Ver Ficha de Cliente"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
