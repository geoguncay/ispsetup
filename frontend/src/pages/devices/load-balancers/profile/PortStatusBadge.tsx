import { Wifi, WifiOff } from 'lucide-react'

export function PortStatusBadge({ running, disabled }: { running: boolean; disabled: boolean }) {
  if (disabled) {
    return (
      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
        Deshabilitada
      </span>
    )
  }
  if (running) {
    return (
      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-fit">
        <Wifi className="w-3 h-3" /> Activa
      </span>
    )
  }
  return (
    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1 w-fit">
      <WifiOff className="w-3 h-3" /> Caída
    </span>
  )
}
