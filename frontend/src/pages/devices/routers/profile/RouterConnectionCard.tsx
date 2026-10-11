import { Server, Network } from 'lucide-react'
import { formatUptime } from '@/lib/utils'

export function RouterConnectionCard({ router }: { router: any }) {
  return (
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2 text-brand-400 font-semibold text-sm border-b border-border/40 pb-2">
              <Server className="w-4.5 h-4.5" />
              <span>Información de Conexión</span>
            </div>

            <div className="space-y-3">
              <div>
                <span className="block text-xs text-muted-foreground">Dirección IP / Host</span>
                <code className="text-sm font-mono text-foreground font-semibold">
                  {router.ip}:{router.api_port}
                </code>
              </div>

              <div>
                <span className="block text-xs text-muted-foreground">Usuario API</span>
                <span className="text-sm text-foreground font-medium">{router.api_username}</span>
              </div>

              {router.zerotier_node_id && (
                <div>
                  <span className="block text-xs text-muted-foreground">ZeroTier</span>
                  <span
                    className={`text-sm font-medium flex items-center gap-1.5 ${
                      router.zerotier_online === false
                        ? 'text-amber-400'
                        : router.zerotier_online === true
                          ? 'text-emerald-400'
                          : 'text-foreground'
                    }`}
                  >
                    <Network className="w-3.5 h-3.5" />
                    {router.zerotier_node_id}
                    {router.zerotier_online === false && ' · nodo sin reportar'}
                    {router.zerotier_online === true && ' · nodo en línea'}
                  </span>
                  {router.status === 'tunnel_down' && (
                    <span className="mt-1 block text-xs text-amber-400/90">
                      El túnel ZeroTier está caído: RouterOS podría seguir operativo. Revisa
                      enlace y energía del sitio.
                    </span>
                  )}
                </div>
              )}

              {router.uptime && (
                <div>
                  <span className="block text-xs text-muted-foreground">Tiempo Activo (Uptime)</span>
                  <span className="text-sm text-foreground font-medium">{formatUptime(router.uptime)}</span>
                </div>
              )}
            </div>
          </div>
  )
}
