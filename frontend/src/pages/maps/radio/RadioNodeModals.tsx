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

function ModalShell({ title, icon: Icon, onClose, onSubmit, saving, error, children }: {
  title: string
  icon: typeof Radio
  onClose: () => void
  onSubmit: () => void
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
          <div className="flex justify-end gap-2 pt-2">
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
          {routers.map((r) => <option key={r.id} value={`router:${r.id}`}>{r.name}</option>)}
        </optgroup>
        <optgroup label="APs y antenas estación">
          {accessPoints.map((a) => (
            <option key={a.id} value={`ap:${a.id}`}>{a.role === 'station' ? '📡 ' : ''}{a.name}</option>
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

const parseFreq = (v: string) => (v.trim() ? parseInt(v, 10) : null)

export interface ApFormValues {
  name: string
  ip: string | null
  frequency_mhz: number | null
  connect_to: NodeRef | null
}

export function ApFormModal({ pos, onSave, ...base }: BaseProps & { pos: Pos; onSave: (v: ApFormValues) => void }) {
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [freq, setFreq] = useState('')
  const [connect, setConnect] = useState('')

  return (
    <ModalShell
      title="Agregar PtMP" icon={Radio} onClose={base.onClose} saving={base.saving} error={base.error}
      onSubmit={() => name.trim() && onSave({ name: name.trim(), ip: ip.trim() || null, frequency_mhz: parseFreq(freq), connect_to: parseRef(connect) })}
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
      <ConnectSelect label="Conectado a" value={connect} onChange={setConnect} routers={base.routers} accessPoints={base.accessPoints} />
      <p className="text-[11px] font-mono text-muted-foreground">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</p>
    </ModalShell>
  )
}

export interface PtpFormValues {
  ap: { name: string; ip: string | null }
  station: { name: string; ip: string | null }
  frequency_mhz: number | null
  connect_to: NodeRef | null
}

export function PtpFormModal({ apPos, stationPos, onSave, ...base }: BaseProps & {
  apPos: Pos
  stationPos: Pos
  onSave: (v: PtpFormValues) => void
}) {
  const [apName, setApName] = useState('')
  const [apIp, setApIp] = useState('')
  const [stName, setStName] = useState('')
  const [stIp, setStIp] = useState('')
  const [freq, setFreq] = useState('')
  const [connect, setConnect] = useState('')

  return (
    <ModalShell
      title="Agregar enlace PtP" icon={ArrowLeftRight} onClose={base.onClose} saving={base.saving} error={base.error}
      onSubmit={() => apName.trim() && stName.trim() && onSave({
        ap: { name: apName.trim(), ip: apIp.trim() || null },
        station: { name: stName.trim(), ip: stIp.trim() || null },
        frequency_mhz: parseFreq(freq),
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
      <Field label="Frecuencia (MHz)">
        <input type="number" min={1} value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="5800" className="input-field" />
      </Field>
      <ConnectSelect label="AP conectado a" value={connect} onChange={setConnect} routers={base.routers} accessPoints={base.accessPoints} />
      <p className="text-[11px] font-mono text-muted-foreground">
        AP: {apPos.lat.toFixed(5)}, {apPos.lng.toFixed(5)} · Estación: {stationPos.lat.toFixed(5)}, {stationPos.lng.toFixed(5)}
      </p>
    </ModalShell>
  )
}
