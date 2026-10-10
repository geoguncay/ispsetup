/** MapSearch — Buscador por nombre, cédula o IP para localizar un elemento (aunque esté tapado por otro). */
import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

export interface SearchItem {
  /** Clave del marcador: 'client:<id>', 'router:<id>' o 'ap:<id>'. */
  key: string
  label: string
  detail: string
  kindLabel: string
  layer: string
}

interface Props {
  items: SearchItem[]
  onSelect: (item: SearchItem) => void
}

const MAX_RESULTS = 8

export function MapSearch({ items, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return items.filter(i => `${i.label} ${i.detail}`.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
  }, [items, query])

  return (
    <div className="relative w-full sm:w-72">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar en el mapa..."
        className="input-field pl-9 pr-8"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {open && query.trim().length >= 2 && (
        <div className="absolute z-[1000] mt-1 w-full glass-card max-h-72 overflow-y-auto border border-border/60 shadow-xl">
          {results.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground m-0">Sin resultados</p>
          ) : results.map((r) => (
            <button
              key={r.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(r); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-secondary/40 transition-colors flex flex-col"
            >
              <span className="text-sm font-medium text-foreground truncate">{r.label}</span>
              <span className="text-[11px] text-muted-foreground truncate">{r.kindLabel}{r.detail ? ` · ${r.detail}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
