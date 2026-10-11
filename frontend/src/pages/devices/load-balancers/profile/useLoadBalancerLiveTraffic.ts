import { useEffect, useState } from 'react'
import type { LbInterface } from './types'

/**
 * Tráfico en vivo del balanceador (WebSocket, solo mientras `enabled`) y serie
 * de los últimos 60 puntos para la interfaz seleccionada (o la suma de todas).
 */
export function useLoadBalancerLiveTraffic(id: string | undefined, enabled: boolean) {
  const [selectedChartInterface, setSelectedChartInterface] = useState('__all__')
  const [liveTick, setLiveTick] = useState<{ timestamp: string; interfaces: LbInterface[] } | null>(null)
  const [liveSeries, setLiveSeries] = useState<{ timestamp: string; rx_rate: number; tx_rate: number }[]>([])

  useEffect(() => {
    if (!enabled || !id) return

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
      return `${wsProtocol}//${wsHost}/api/load-balancers/ws/${id}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        setLiveTick({ timestamp: payload.timestamp, interfaces: payload.interfaces || [] })
      } catch (err) {
        console.error('Error al procesar tráfico en vivo del balanceador:', err)
      }
    }
    return () => ws.close()
  }, [enabled, id])

  useEffect(() => { setLiveSeries([]) }, [selectedChartInterface])

  useEffect(() => {
    if (!liveTick) return
    let rx = 0
    let tx = 0
    if (selectedChartInterface === '__all__') {
      rx = liveTick.interfaces.reduce((acc, i) => acc + i.rx_rate, 0)
      tx = liveTick.interfaces.reduce((acc, i) => acc + i.tx_rate, 0)
    } else {
      const iface = liveTick.interfaces.find((i) => i.name === selectedChartInterface)
      rx = iface?.rx_rate ?? 0
      tx = iface?.tx_rate ?? 0
    }
    setLiveSeries((prev) => [...prev.slice(-59), { timestamp: liveTick.timestamp, rx_rate: rx, tx_rate: tx }])
  }, [liveTick, selectedChartInterface])

  return { selectedChartInterface, setSelectedChartInterface, liveSeries }
}
