/**
 * WanLinkFormDialog — Modal para agregar o editar un único enlace WAN del
 * balanceador. Guarda toda la configuración de balanceo (no solo este enlace);
 * aplicarla en el equipo se hace aparte, con el botón debajo del listado de
 * enlaces en la pestaña Balanceo.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Network, X } from 'lucide-react'

export interface WanLink {
  interface: string
  gateway: string
  weight: number
  priority: number
}

interface WanLinkFormDialogProps {
  open: boolean
  onClose: () => void
  algorithm: 'pcc' | 'failover'
  link: WanLink | null // null = agregar enlace nuevo
  availableInterfaces: string[]
  isSaving: boolean
  onSave: (link: WanLink) => void
}

export function WanLinkFormDialog({
  open,
  onClose,
  algorithm,
  link,
  availableInterfaces,
  isSaving,
  onSave,
}: WanLinkFormDialogProps) {
  const isEdit = !!link
  const [interfaceName, setInterfaceName] = useState('')
  const [gateway, setGateway] = useState('')
  const [weight, setWeight] = useState(1)
  const [priority, setPriority] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setInterfaceName(link?.interface ?? '')
      setGateway(link?.gateway ?? '')
      setWeight(link?.weight ?? 1)
      setPriority(link?.priority ?? 0)
      setError(null)
    }
  }, [open, link])

  if (!open) return null

  const buildLink = (): WanLink | null => {
    if (!interfaceName.trim() || !gateway.trim()) {
      setError('Interfaz y Gateway son obligatorios')
      return null
    }
    return {
      interface: interfaceName.trim(),
      gateway: gateway.trim(),
      weight: Math.max(1, Number(weight) || 1),
      priority: Math.max(0, Number(priority) || 0),
    }
  }

  const handleSave = () => {
    const built = buildLink()
    if (built) onSave(built)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-xl mx-4 animate-fade-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Network className="w-4.5 h-4.5 text-brand-400" />
            {isEdit ? 'Editar enlace WAN' : 'Agregar enlace WAN'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Interfaz *</label>
            <input
              type="text"
              list="wan-link-iface-options"
              value={interfaceName}
              onChange={(e) => setInterfaceName(e.target.value)}
              placeholder="ether1"
              className="input-field font-mono"
              autoFocus
            />
            <datalist id="wan-link-iface-options">
              {availableInterfaces.map((name) => <option key={name} value={name} />)}
            </datalist>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Gateway *</label>
            <input
              type="text"
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              placeholder="192.168.1.1"
              className="input-field font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {algorithm === 'pcc' ? 'Peso' : 'Prioridad (0 = principal)'}
            </label>
            <input
              type="number"
              min={algorithm === 'pcc' ? 1 : 0}
              value={algorithm === 'pcc' ? weight : priority}
              onChange={(e) => (algorithm === 'pcc' ? setWeight(Number(e.target.value)) : setPriority(Number(e.target.value)))}
              className="input-field font-mono"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-border/50 p-5">
          <button type="button" onClick={onClose} disabled={isSaving} className="btn-secondary flex-1 justify-center">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving} className="btn-primary flex-1 justify-center">
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar configuración
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
