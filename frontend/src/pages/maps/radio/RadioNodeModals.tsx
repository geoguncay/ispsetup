/** Modales para agregar un AP o un enlace PtP (AP + antena estación) al mapa de radio. */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Radio, ArrowLeftRight } from 'lucide-react'
import type { MapAccessPoint, MapRouter, NodeRef } from '../mapTypes'

type Pos = { lat: number; lng: number }

interface BaseProps {
  routers: MapRouter[]
  accessPoints: MapAccessPoint[]
  saving: boolean
  error: string | null
  onClose: () => void
}

function ModalShell({ title, icon: Icon, onClose, onSubmit, onDelete, saving, error, children }: {
  title: string
  icon: typeof Radio
  onClose: () => void
  onSubmit: () => void
  /** Si se define, muestra el botón Eliminar (modo edición). */
  onDelete?: () => void
  saving: boolean
  error: string | null
  children: React.ReactNode
}) {
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-lg mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit() }}
          className="p-5 space-y-4"
        >
          {children}
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex items-center gap-2 pt-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="text-sm font-semibold text-red-400 hover:text-red-300 cursor-pointer mr-auto disabled:opacity-60"
              >
                Eliminar
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="btn-secondary cursor-pointer">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary cursor-pointer disabled:opacity-60">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function ConnectSelect({ value, onChange, routers, accessPoints, label }: {
  value: string
  onChange: (v: string) => void
  routers: MapRouter[]
  accessPoints: MapAccessPoint[]
  label: string
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field cursor-pointer">
        <option value="">Sin conexión</option>
        <optgroup label="Routers">
          {routers.map((r) => <option key={r.id} value={`router:${r.id}`}>{`📶`} {r.name}</option>)}
        </optgroup>
        <optgroup label="APs y antenas estación">
          {accessPoints.map((a) => (
            <option key={a.id} value={`ap:${a.id}`}>{`🛜`} {a.name}</option>
          ))}
        </optgroup>
      </select>
    </Field>
  )
}

const parseRef = (v: string): NodeRef | null => {
  if (!v) return null
  const [type, id] = v.split(':')
  return { type: type as NodeRef['type'], id }
}

const CHANNEL_WIDTHS = [5, 10, 20, 30, 40, 60, 80]

function ChannelWidthSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Ancho de canal (MHz)">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field cursor-pointer">
        <option value="">Sin especificar</option>
        {CHANNEL_WIDTHS.map((w) => <option key={w} value={w}>{w} MHz</option>)}
      </select>
    </Field>
  )
}

const parseFreq = (v: string) => (v.trim() ? parseInt(v, 10) : null)

export interface ApFormValues {
  name: string
  ip: string | null
  frequency_mhz: number | null
  channel_width_mhz: number | null
  rotation_deg: number
  connect_to: NodeRef | null
}

/** Datos de un AP existente (modo edición). */
export type ApInitial = Pick<MapAccessPoint, 'name' | 'ip' | 'frequency_mhz' | 'channel_width_mhz' | 'rotation_deg'>

export function ApFormModal({ pos, initial, initialConnect = '', onSave, onDelete, ...base }: BaseProps & {
  pos: Pos
  /** Si se define, el modal edita ese AP en lugar de crear uno nuevo. */
  initial?: ApInitial
  /** Conexión actual en modo edición, como 'router:<id>' o 'ap:<id>'. */
  initialConnect?: string
  /** AP que no pueden ser destino de la conexión (él mismo). */
  excludeApIds?: string[]
  onSave: (v: ApFormValues) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [ip, setIp] = useState(initial?.ip ?? '')
  const [freq, setFreq] = useState(initial?.frequency_mhz?.toString() ?? '')
  const [width, setWidth] = useState(initial?.channel_width_mhz?.toString() ?? '')
  const [rotation, setRotation] = useState(initial?.rotation_deg ?? 0)
  const [connect, setConnect] = useState(initialConnect)

  return (
    <ModalShell
      title={initial ? 'Editar PtMP' : 'Agregar PtMP'} icon={Radio} onClose={base.onClose} onDelete={onDelete} saving={base.saving} error={base.error}
      onSubmit={() => name.trim() && onSave({ name: name.trim(), ip: ip.trim() || null, frequency_mhz: parseFreq(freq), channel_width_mhz: parseFreq(width), rotation_deg: rotation, connect_to: parseRef(connect) })}
    >
      <Field label="Nombre del AP *">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="AP Torre Norte" className="input-field" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="IP">
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="10.10.0.2" className="input-field font-mono" />
        </Field>
        <Field label="Frecuencia (MHz)">
          <input type="number" min={1} value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="5800" className="input-field" />
        </Field>
      </div>
      <ChannelWidthSelect value={width} onChange={setWidth} />
      <Field label={`Orientación del icono: ${rotation}°`}>
        <div className="flex items-center gap-3">
          <input
            type="range" min={0} max={359} value={rotation}
            onChange={(e) => setRotation(parseInt(e.target.value, 10))}
            className="flex-1 cursor-pointer"
          />
          <div
            className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center shrink-0"
            style={{ transform: `rotate(${rotation}deg)` }}
            title="Vista previa: las ondas apuntan hacia donde mira la antena"
          >
            <svg viewBox="0 0 36 36" width="36" height="36">
              <g stroke="white" strokeWidth="2" strokeLinecap="round" fill="none">
                <path d="M10.5 14.5a10.5 10.5 0 0 1 15 0M13.3 17.6a6.4 6.4 0 0 1 9.4 0" />
              </g>
              <circle cx="18" cy="21.5" r="2" fill="white" />
            </svg>
          </div>
        </div>
      </Field>
      <ConnectSelect
        label="Conectado a" value={connect} onChange={setConnect} routers={base.routers}
        accessPoints={base.accessPoints.filter(a => !base.excludeApIds?.includes(a.id))}
      />
      <p className="text-[11px] font-mono text-muted-foreground">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</p>
    </ModalShell>
  )
}

export interface PtpFormValues {
  ap: { name: string; ip: string | null }
  station: { name: string; ip: string | null }
  frequency_mhz: number | null
  channel_width_mhz: number | null
  connect_to: NodeRef | null
}

/** Radios de un PtP existente (modo edición). */
export interface PtpInitial {
  ap: MapAccessPoint
  station: MapAccessPoint
}

export function PtpFormModal({ apPos, stationPos, initial, initialConnect = '', onSave, onDelete, ...base }: BaseProps & {
  apPos: Pos
  stationPos: Pos
  /** Si se define, el modal edita ese PtP en lugar de crear uno nuevo. */
  initial?: PtpInitial
  /** Conexión actual del AP en modo edición, como 'router:<id>' o 'ap:<id>'. */
  initialConnect?: string
  /** AP que no pueden ser destino de la conexión (los propios del PtP). */
  excludeApIds?: string[]
  onSave: (v: PtpFormValues) => void
  onDelete?: () => void
}) {
  const [apName, setApName] = useState(initial?.ap.name ?? '')
  const [apIp, setApIp] = useState(initial?.ap.ip ?? '')
  const [stName, setStName] = useState(initial?.station.name ?? '')
  const [stIp, setStIp] = useState(initial?.station.ip ?? '')
  const [freq, setFreq] = useState(initial?.ap.frequency_mhz?.toString() ?? '')
  const [width, setWidth] = useState(initial?.ap.channel_width_mhz?.toString() ?? '')
  const [connect, setConnect] = useState(initialConnect)

  return (
    <ModalShell
      title={initial ? 'Editar enlace PtP' : 'Agregar enlace PtP'} icon={ArrowLeftRight} onClose={base.onClose} onDelete={onDelete} saving={base.saving} error={base.error}
      onSubmit={() => apName.trim() && stName.trim() && onSave({
        ap: { name: apName.trim(), ip: apIp.trim() || null },
        station: { name: stName.trim(), ip: stIp.trim() || null },
        frequency_mhz: parseFreq(freq),
        channel_width_mhz: parseFreq(width),
        connect_to: parseRef(connect),
      })}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre del AP *">
          <input autoFocus value={apName} onChange={(e) => setApName(e.target.value)} placeholder="PtP Torre A" className="input-field" required />
        </Field>
        <Field label="IP del AP">
          <input value={apIp} onChange={(e) => setApIp(e.target.value)} placeholder="10.10.1.1" className="input-field font-mono" />
        </Field>
        <Field label="Nombre de la estación *">
          <input value={stName} onChange={(e) => setStName(e.target.value)} placeholder="PtP Torre B" className="input-field" required />
        </Field>
        <Field label="IP de la estación">
          <input value={stIp} onChange={(e) => setStIp(e.target.value)} placeholder="10.10.1.2" className="input-field font-mono" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Frecuencia (MHz)">
          <input type="number" min={1} value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="5800" className="input-field" />
        </Field>
        <ChannelWidthSelect value={width} onChange={setWidth} />
      </div>
      <ConnectSelect
        label="AP conectado a" value={connect} onChange={setConnect} routers={base.routers}
        accessPoints={base.accessPoints.filter(a => !base.excludeApIds?.includes(a.id))}
      />
      <p className="text-[11px] font-mono text-muted-foreground">
        AP: {apPos.lat.toFixed(5)}, {apPos.lng.toFixed(5)} · Estación: {stationPos.lat.toFixed(5)}, {stationPos.lng.toFixed(5)}
      </p>
    </ModalShell>
  )
}
