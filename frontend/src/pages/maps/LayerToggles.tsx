/** LayerToggles — Casillas para mostrar u ocultar cada tipo de elemento del mapa. */

export interface MapLayer {
  id: string
  label: string
  count: number
}

interface Props {
  layers: MapLayer[]
  visible: Record<string, boolean>
  onToggle: (id: string) => void
}

export function LayerToggles({ layers, visible, onToggle }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Capas</span>
      {layers.map((l) => (
        <label key={l.id} className="flex items-center gap-1.5 text-sm text-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={visible[l.id] ?? true}
            onChange={() => onToggle(l.id)}
            className="cursor-pointer"
          />
          {l.label}
          <span className="text-xs text-muted-foreground">({l.count})</span>
        </label>
      ))}
    </div>
  )
}
