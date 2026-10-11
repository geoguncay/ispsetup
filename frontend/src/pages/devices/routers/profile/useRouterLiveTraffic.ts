import { useEffect, useState } from 'react'

/**
 * Ranking en vivo de clientes por consumo y bytes del bridge, vía WebSocket
 * del canal de tráfico del router. Solo se conecta si el router ya tiene
 * sus ajustes operativos configurados.
 */
export function useRouterLiveTraffic(
  routerId: string | undefined,
  settingsConfigured: boolean | undefined,
  trafficAccounting: string | undefined,
) {
  const [liveClients, setLiveClients] = useState<any[]>([])
  const [bridgeBytes, setBridgeBytes] = useState<{ rx: number; tx: number } | null>(null)

  useEffect(() => {
    if (settingsConfigured !== true) return

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
      return `${wsProtocol}//${wsHost}/api/traffic/ws/${routerId}?token=${token}`
    })()

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const clients = payload.clients || []
        const interfaces = payload.interfaces || []

        // En modo Traffic Flow, el colector NetFlow (clientes) y el polling
        // de interfaces (poll_traffic) publican mensajes separados en el
        // mismo canal Redis. Un mensaje con interfaces no vacías viene del
        // polling y no trae datos reales de clientes en esta modalidad; se
        // ignora para no pisar el último dato de clientes que sí reportó NetFlow.
        const isTrafficFlow = trafficAccounting === 'traffic_flow'
        if (!(isTrafficFlow && interfaces.length > 0)) {
          const sortedClients = [...clients].sort((a: any, b: any) => (b.rx_rate + b.tx_rate) - (a.rx_rate + a.tx_rate))
          setLiveClients(sortedClients)
        }
        const bridge = interfaces.find((i: any) => i.name === 'bridge1')
        if (bridge) setBridgeBytes({ rx: bridge.rx_bytes || 0, tx: bridge.tx_bytes || 0 })
      } catch (err) {
        console.error('Error al procesar mensaje de tráfico en vivo:', err)
      }
    }

    return () => {
      ws.close()
    }
  }, [routerId, settingsConfigured, trafficAccounting])

  return { liveClients, bridgeBytes }
}
