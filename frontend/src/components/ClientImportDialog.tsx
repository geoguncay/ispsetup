/**
 * ClientImportDialog — Modal Asistente para importar clientes desde un CSV.
 * v2: Gateway global por lote, tipo de conexión, coordenadas aleatorias dentro de 1km.
 */
import { useState, useEffect } from 'react'
import { X, Loader2, Upload, FileSpreadsheet, ArrowRight, AlertTriangle, CheckCircle, HelpCircle, Download, MapPin } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import api from '@/services/api'

interface ClientImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

interface GatewayOption {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
}

interface PlanOption {
  id: string
  name: string
}

type ConnectionType = 'static' | 'pppoe' | 'mixto'

const SYSTEM_FIELDS = [
  { key: 'apellidos',      label: 'Apellidos',                        showFor: ['static', 'pppoe', 'mixto'] as ConnectionType[], requiredFor: ['static', 'pppoe', 'mixto'] as ConnectionType[] },
  { key: 'nombres',        label: 'Nombres',                          showFor: ['static', 'pppoe', 'mixto'] as ConnectionType[], requiredFor: ['static', 'pppoe', 'mixto'] as ConnectionType[] },
  { key: 'cedula',         label: 'Cédula / RUC',                     showFor: ['static', 'pppoe', 'mixto'] as ConnectionType[], requiredFor: ['static', 'pppoe', 'mixto'] as ConnectionType[] },
  { key: 'telefono',       label: 'Teléfono',                         showFor: ['static', 'pppoe', 'mixto'] as ConnectionType[], requiredFor: ['static', 'pppoe', 'mixto'] as ConnectionType[] },
  { key: 'direccion',      label: 'Dirección',                        showFor: ['static', 'pppoe', 'mixto'] as ConnectionType[], requiredFor: ['static', 'pppoe', 'mixto'] as ConnectionType[] },
  { key: 'email',          label: 'Correo Electrónico',               showFor: ['static', 'pppoe', 'mixto'] as ConnectionType[], requiredFor: [] as ConnectionType[] },
  { key: 'plan',           label: 'Plan de Internet',                 showFor: ['pppoe', 'mixto'] as ConnectionType[],            requiredFor: ['pppoe'] as ConnectionType[] },
  { key: 'tipo',           label: 'Tipo de Conexión (static/pppoe)', showFor: ['mixto'] as ConnectionType[],                    requiredFor: [] as ConnectionType[] },
  { key: 'ip',             label: 'Dirección IP (Estático)',          showFor: ['static', 'mixto'] as ConnectionType[],          requiredFor: ['static'] as ConnectionType[] },
  { key: 'mac',            label: 'Dirección MAC',                    showFor: ['static', 'mixto'] as ConnectionType[],          requiredFor: [] as ConnectionType[] },
  { key: 'ppp_username',   label: 'Usuario PPPoE',                    showFor: ['pppoe', 'mixto'] as ConnectionType[],            requiredFor: ['pppoe'] as ConnectionType[] },
  { key: 'ppp_password',   label: 'Contraseña PPPoE',                 showFor: ['pppoe', 'mixto'] as ConnectionType[],            requiredFor: ['pppoe'] as ConnectionType[] },
]

const STEP_LABELS = ['Subir CSV', 'Configurar Lote', 'Mapear Columnas', 'Validar y Previsualizar', 'Finalizar']

function randomCoordNear(lat: number, lng: number, radiusM = 1000) {
  const r = radiusM * Math.sqrt(Math.random())
  const angle = Math.random() * 2 * Math.PI
  return {
    latitude: lat + (r * Math.cos(angle)) / 111300,
    longitude: lng + (r * Math.sin(angle)) / (111300 * Math.cos((lat * Math.PI) / 180)),
  }
}

export function ClientImportDialog({ isOpen, onClose, onSuccess }: ClientImportDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [step3Phase, setStep3Phase] = useState<'mapping' | 'summary'>('mapping')
  const [step3Summary, setStep3Summary] = useState<{ valid: number; duplicates: number; otherErrors: number } | null>(null)
  const [step4Phase, setStep4Phase] = useState<'plan-mapping' | 'preview'>('plan-mapping')
  const [enabledOptionalKeys, setEnabledOptionalKeys] = useState<Set<string>>(new Set())

  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<any[]>([])
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [mappedData, setMappedData] = useState<any[]>([])

  const [connectionType, setConnectionType] = useState<ConnectionType>('static')
  const [selectedGatewayId, setSelectedGatewayId] = useState<string>('')
  const [assignCoordinates, setAssignCoordinates] = useState(true)
  const [planMappings, setPlanMappings] = useState<Record<string, string>>({})

  const [validationResult, setValidationResult] = useState<any>(null)
  const [importResult, setImportResult] = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set())

  const { data: dbGateways = [] } = useQuery<GatewayOption[]>({
    queryKey: ['gateways-import-dropdown'],
    queryFn: async () => { const { data } = await api.get('/gateways'); return data },
    enabled: isOpen,
  })

  const { data: dbPlans = [] } = useQuery<PlanOption[]>({
    queryKey: ['plans-import-dropdown'],
    queryFn: async () => { const { data } = await api.get('/plans'); return data },
    enabled: isOpen,
  })

  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setStep3Phase('mapping')
      setStep3Summary(null)
      setStep4Phase('plan-mapping')
      setEnabledOptionalKeys(new Set())
      setCsvHeaders([])
      setCsvRows([])
      setColumnMapping({})
      setMappedData([])
      setConnectionType('static')
      setSelectedGatewayId('')
      setAssignCoordinates(true)
      setPlanMappings({})
      setValidationResult(null)
      setImportResult(null)
      setErrorMsg(null)
      setSelectedRowIndexes(new Set())
    }
  }, [isOpen])

  const selectedGateway = dbGateways.find(g => g.id === selectedGatewayId) ?? null
  const gatewayHasCoords = !!(selectedGateway?.latitude != null && selectedGateway?.longitude != null)

  const requiredFields = SYSTEM_FIELDS.filter(f => f.showFor.includes(connectionType) && f.requiredFor.includes(connectionType))
  const optionalFields  = SYSTEM_FIELDS.filter(f => f.showFor.includes(connectionType) && !f.requiredFor.includes(connectionType))
  const activeFields    = [...requiredFields, ...optionalFields.filter(f => enabledOptionalKeys.has(f.key))]

  const toggleOptionalField = (key: string) => {
    setEnabledOptionalKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        setColumnMapping(m => { const n = { ...m }; delete n[key]; return n })
      } else {
        next.add(key)
      }
      return next
    })
  }

  const proceedToStep4 = (data: any) => {
    if (data.detected_plans.length > 0) {
      setStep(4); setStep4Phase('plan-mapping')
    } else {
      setSelectedRowIndexes(new Set<number>(
        data.rows.filter((r: any) => r.valid).map((r: any) => r.index as number)
      ))
      setStep(4); setStep4Phase('preview')
    }
  }

  // ── Paso 1: Parsear CSV ──────────────────────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return
      try {
        const lines = text.split(/\r?\n/)
        if (!lines.length || !lines[0].trim()) {
          setErrorMsg('El archivo seleccionado está vacío.')
          return
        }
        const parseLine = (line: string) =>
          line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^["']|["']$/g, '').trim())

        const headers = parseLine(lines[0])
        const rows: any[] = []
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue
          const values = parseLine(lines[i])
          const rowObj: Record<string, string> = {}
          headers.forEach((h, idx) => { rowObj[h] = values[idx] || '' })
          rows.push(rowObj)
        }

        setCsvHeaders(headers)
        setCsvRows(rows)
        setErrorMsg(null)

        // Pre-mapeo inteligente guardado para el Paso 3
        const initialMapping: Record<string, string> = {}
        SYSTEM_FIELDS.forEach(field => {
          const match = headers.find(h => {
            const clean = h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            const key = field.key.toLowerCase()
            return clean === key || clean.includes(key) ||
              (key === 'cedula' && (clean.includes('ruc') || clean.includes('identificacion'))) ||
              (key === 'telefono' && (clean.includes('phone') || clean.includes('celular') || clean.includes('movil'))) ||
              (key === 'direccion' && clean.includes('address')) ||
              (key === 'ppp_username' && clean.includes('usuario_ppp')) ||
              (key === 'ppp_password' && clean.includes('contrasena_ppp'))
          })
          if (match) initialMapping[field.key] = match
        })
        setColumnMapping(initialMapping)
        setStep(2)
      } catch {
        setErrorMsg('Error al procesar el CSV. Verifique que sea un archivo delimitado por comas válido.')
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  // ── Paso 3: Aplicar mapeo y validar ─────────────────────────────────────────
  const applyColumnMapping = () => {
    const missing = requiredFields.filter(f => !columnMapping[f.key])
    if (missing.length > 0) {
      setErrorMsg(`Campos obligatorios sin mapear: ${missing.map(f => f.label).join(', ')}`)
      return
    }
    setErrorMsg(null)

    const mapped = csvRows.map(row => {
      const obj: any = { router: selectedGatewayId }
      activeFields.forEach(field => {
        const col = columnMapping[field.key]
        obj[field.key] = col ? row[col] : ''
      })
      return obj
    })
    setMappedData(mapped)
    validateMutation.mutate(mapped)
  }

  const validateMutation = useMutation({
    mutationFn: async (payload: any[]) => {
      const { data } = await api.post('/clients/import/validate', payload)
      return data
    },
    onSuccess: (data) => {
      setValidationResult(data)

      // Calcular resumen para mostrar en paso 3 antes de avanzar
      const duplicates = data.rows.filter((r: any) =>
        r.errors?.some((e: string) => e.includes('ya está registrada') || e.includes('ya está registrado'))
      ).length
      setStep3Summary({ valid: data.valid_rows, duplicates, otherErrors: data.invalid_rows - duplicates })
      setStep3Phase('summary')

      // Pre-mapeo de planes para tenerlos listos al avanzar
      if (data.detected_plans.length > 0) {
        const initial: Record<string, string> = {}
        data.detected_plans.forEach((name: string) => {
          const found = dbPlans.find(p => p.name.toLowerCase().trim() === name.toLowerCase().trim() || p.id === name)
          if (found) initial[name] = found.id
        })
        setPlanMappings(initial)
      }
    },
    onError: (err: any) => setErrorMsg(err.response?.data?.detail ?? 'Error al validar datos con el servidor.'),
  })

  // ── Paso 4 (fase plan-mapping): Revalidar con IDs resueltos ────────────────
  const runFinalValidation = () => {
    setErrorMsg(null)
    const finalized = mappedData.map(row => {
      const resolvedPlan = planMappings[row.plan] ?? ''
      const coords =
        assignCoordinates && selectedGateway?.latitude != null && selectedGateway?.longitude != null
          ? randomCoordNear(selectedGateway.latitude, selectedGateway.longitude)
          : {}
      return { ...row, plan: resolvedPlan, ...coords }
    })
    setMappedData(finalized)
    revalidateMutation.mutate(finalized)
  }

  const revalidateMutation = useMutation({
    mutationFn: async (payload: any[]) => {
      const { data } = await api.post('/clients/import/validate', payload)
      return data
    },
    onSuccess: (data) => {
      setValidationResult(data)
      setSelectedRowIndexes(new Set<number>(
        data.rows.filter((r: any) => r.valid).map((r: any) => r.index as number)
      ))
      setStep4Phase('preview')
    },
    onError: (err: any) => setErrorMsg(err.response?.data?.detail ?? 'Error al revalidar datos.'),
  })

  // ── Paso 4 (fase preview): Importar definitivamente ────────────────────────
  const importMutation = useMutation({
    mutationFn: async (clientsToImport: any[]) => {
      const payload = {
        clients: clientsToImport.map(row => {
          // Coordenadas: usar las ya generadas o generar ahora si el path fue directo (static sin planes)
          const coords =
            assignCoordinates && selectedGateway?.latitude != null && selectedGateway?.longitude != null && row.latitude == null
              ? randomCoordNear(selectedGateway.latitude, selectedGateway.longitude)
              : { latitude: row.latitude ?? null, longitude: row.longitude ?? null }
          return {
            name: row.nombre || null,
            last_name: row.apellidos,
            first_name: row.nombres,
            cedula: row.cedula,
            phone: row.telefono,
            address: row.direccion,
            email: row.email || null,
            gateway_id: selectedGatewayId,
            plan_id: row.plan || null,
            connection_type: row.tipo || (connectionType !== 'mixto' ? connectionType : 'static'),
            ip: row.ip || null,
            mac: row.mac || null,
            notes_ip: null,
            ppp_username: row.ppp_username || null,
            ppp_password: row.ppp_password || null,
            billing_start: row.inicio_facturacion || null,
            billing_period_start_day: row.dia_inicio_periodo ? parseInt(row.dia_inicio_periodo) : 1,
            auto_apply_payment: true,
            use_auto_credit: true,
            separate_proration: true,
            ...coords,
          }
        }),
      }
      const { data } = await api.post('/clients/import/commit', payload, { timeout: 180_000 })
      return data
    },
    onSuccess: (data) => {
      setImportResult(data)
      setStep(5)
      onSuccess?.()
    },
    onError: (err: any) => {
      if (err.code === 'ECONNABORTED') {
        setErrorMsg('La importación está tardando más de lo esperado en el servidor. Cierra el asistente y recarga la página para verificar si los datos fueron importados correctamente.')
      } else {
        setErrorMsg(err.response?.data?.detail ?? 'Ocurrió un error al procesar la importación masiva.')
      }
    },
  })

  const handleImportCommit = () => {
    const clientsToImport = mappedData.filter((_, idx) => selectedRowIndexes.has(idx))
    if (clientsToImport.length === 0) {
      setErrorMsg('No hay clientes seleccionados para importar.')
      return
    }
    setErrorMsg(null)
    importMutation.mutate(clientsToImport)
  }

  // ── Plantilla CSV según tipo ────────────────────────────────────────────────
  const downloadTemplate = (type: ConnectionType) => {
    const baseHeader = 'apellidos,nombres,cedula,telefono,direccion,email'
    const baseRow1 = 'Perez Garcia,Juan Andres,1712345678,0998887766,"Av. Amazonas 123 y Colon, Quito",juan@example.com'
    const baseRow2 = 'Lopez Lopez,Maria,1798765432,0991112233,"Av. 12 de Octubre, Quito",maria@example.com'

    const ext: Record<ConnectionType, { h: string; r1: string; r2: string }> = {
      static: { h: ',ip,mac',         r1: ',192.168.10.50,AA:BB:CC:DD:EE:FF', r2: ',192.168.10.51,' },
      pppoe:  { h: ',plan,usuario_ppp,contraseña_ppp', r1: ',Plan Hogar 50Mbps,juan_ppp,clave123', r2: ',Plan Corporativo 100Mbps,maria_ppp,clave456' },
      mixto:  { h: ',tipo,ip,mac,plan,usuario_ppp,contraseña_ppp', r1: ',static,192.168.10.50,AA:BB:CC:DD:EE:FF,,,', r2: ',pppoe,,,Plan Hogar 50Mbps,maria_ppp,clave456' },
    }
    const { h, r1, r2 } = ext[type]
    const csv = `${baseHeader}${h}\n${baseRow1}${r1}\n${baseRow2}${r2}\n`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `plantilla_clientes_${type}.csv`
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const validRowIndexes: number[] = validationResult
    ? validationResult.rows.filter((r: any) => r.valid).map((r: any) => r.index as number)
    : []
  const allValidSelected = validRowIndexes.length > 0 && validRowIndexes.every(i => selectedRowIndexes.has(i))
  const someValidSelected = validRowIndexes.some(i => selectedRowIndexes.has(i))

  const toggleRowSelection = (index: number) => {
    setSelectedRowIndexes(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const toggleAllValid = () => {
    setSelectedRowIndexes(allValidSelected ? new Set() : new Set<number>(validRowIndexes))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-card w-full max-w-4xl shadow-2xl relative flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-400" />
            Asistente de Importación de Clientes
          </h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 bg-secondary/20 border-b border-border/40 flex items-center justify-around text-xs font-semibold text-muted-foreground">
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3 | 4 | 5
            return (
              <div key={n} className="flex items-center gap-2">
                <span className={`flex items-center gap-1.5 transition-colors ${step === n ? 'text-brand-400 font-bold' : step > n ? 'text-emerald-400' : ''}`}>
                  {step > n ? <CheckCircle className="w-4 h-4" /> : `${n}.`} {label}
                </span>
                {n < 5 && <ArrowRight className="w-3 h-3 opacity-30" />}
              </div>
            )
          })}
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── PASO 1: Subir CSV ── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="relative flex flex-col items-center justify-center h-56 border-2 border-dashed border-border/80 rounded-xl hover:border-brand-500/50 transition-all bg-secondary/10 group cursor-pointer">
                <input type="file" accept=".csv" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                <Upload className="w-12 h-12 text-muted-foreground group-hover:text-brand-400 transition-colors mb-3" />
                <p className="text-sm font-semibold text-foreground">Arrastra tu archivo CSV aquí</p>
                <p className="text-xs text-muted-foreground mt-1">o haz clic para seleccionar</p>
              </div>

              <div className="p-4 bg-secondary/20 border border-border/60 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Download className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Plantillas CSV</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Sin columna de gateway — se asigna en el siguiente paso.</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {(['static', 'pppoe', 'mixto'] as ConnectionType[]).map(t => (
                    <button key={t} type="button" onClick={() => downloadTemplate(t)} className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1 cursor-pointer capitalize">
                      <Download className="w-3 h-3" /> {t === 'static' ? 'Estático' : t === 'pppoe' ? 'PPPoE' : 'Mixto'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── PASO 2: Configurar Lote ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="p-4 bg-secondary/20 border border-border/60 rounded-xl">
                <h4 className="text-sm font-bold text-foreground mb-1 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-brand-400" />
                  Configuración del Lote
                </h4>
                <p className="text-xs text-muted-foreground">
                  Define el gateway destino y el tipo de conexión para todos los clientes de este CSV.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Gateway selector */}
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1">
                    Gateway de Destino <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedGatewayId}
                    onChange={e => setSelectedGatewayId(e.target.value)}
                    className="input-field cursor-pointer text-sm"
                  >
                    <option value="">-- Seleccionar Gateway --</option>
                    {dbGateways.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  {selectedGateway && (
                    <p className={`text-xs flex items-center gap-1.5 mt-1 ${gatewayHasCoords ? 'text-brand-400' : 'text-amber-400'}`}>
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      {gatewayHasCoords
                        ? `Coordenadas: ${selectedGateway.latitude?.toFixed(5)}, ${selectedGateway.longitude?.toFixed(5)}`
                        : 'Este gateway no tiene coordenadas configuradas — ubicación aleatoria no disponible.'
                      }
                    </p>
                  )}
                </div>

                {/* Tipo de conexión */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-foreground">Tipo de Conexión</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'static', label: 'IP Estática' },
                      { value: 'pppoe',  label: 'PPPoE' },
                      { value: 'mixto',  label: 'Mixto' },
                    ] as { value: ConnectionType; label: string }[]).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setConnectionType(value)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                          connectionType === value
                            ? 'bg-brand-500/20 border-brand-500/50 text-brand-300'
                            : 'bg-secondary/30 border-border/40 text-muted-foreground hover:border-brand-500/30'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {connectionType === 'static' && 'IP estática por cliente. El CSV debe incluir columna de IP.'}
                    {connectionType === 'pppoe'  && 'PPPoE por cliente. El CSV debe incluir usuario, contraseña y plan.'}
                    {connectionType === 'mixto'  && 'CSV mixto con columna "tipo" que indica static o pppoe por fila.'}
                  </p>
                </div>

                {/* Toggle coordenadas aleatorias */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-brand-400" />
                    Ubicación Aleatoria
                  </label>
                  <button
                    type="button"
                    disabled={!gatewayHasCoords}
                    onClick={() => setAssignCoordinates(v => !v)}
                    className={`flex items-center gap-3 w-full p-3 rounded-lg border text-left transition-all ${
                      !gatewayHasCoords
                        ? 'opacity-40 cursor-not-allowed bg-secondary/20 border-border/30'
                        : assignCoordinates
                          ? 'bg-brand-500/10 border-brand-500/30 cursor-pointer'
                          : 'bg-secondary/30 border-border/40 cursor-pointer'
                    }`}
                  >
                    {/* Toggle visual */}
                    <div className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${assignCoordinates && gatewayHasCoords ? 'bg-brand-500' : 'bg-muted'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${assignCoordinates && gatewayHasCoords ? 'left-5' : 'left-0.5'}`} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        {assignCoordinates && gatewayHasCoords ? 'Activo' : 'Inactivo'}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        Asigna una ubicación aleatoria dentro de 1km del gateway para proteger la dirección exacta del cliente.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button onClick={() => setStep(1)} className="btn-secondary px-4 py-2">Atrás</button>
                <button
                  onClick={() => {
                    if (!selectedGatewayId) { setErrorMsg('Debe seleccionar un gateway de destino.'); return }
                    setErrorMsg(null)
                    // Inicializar todos los opcionales como habilitados al entrar al paso 3
                    const optionals = SYSTEM_FIELDS
                      .filter(f => f.showFor.includes(connectionType) && !f.requiredFor.includes(connectionType))
                      .map(f => f.key)
                    setEnabledOptionalKeys(new Set(optionals))
                    setStep3Phase('mapping')
                    setStep3Summary(null)
                    setStep(3)
                  }}
                  className="btn-primary px-6 py-2 flex items-center gap-1.5"
                >
                  Continuar <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Mapear Columnas ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Fase A: Mapeo */}
              {step3Phase === 'mapping' && (
                <>
                  <div className="p-4 bg-secondary/20 border border-border/60 rounded-xl flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-foreground mb-1 flex items-center gap-1.5">
                        <HelpCircle className="w-4 h-4 text-brand-400" />
                        Mapeo de Columnas
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Activa o desactiva los campos opcionales con el checkbox. Los marcados con <span className="text-red-400 font-bold">*</span> son obligatorios y no se pueden desactivar.
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-brand-300 bg-brand-500/10 border border-brand-500/20 px-2 py-1 rounded-md shrink-0 ml-4">
                      {connectionType === 'static' ? 'IP Estática' : connectionType === 'pppoe' ? 'PPPoE' : 'Mixto'}
                    </span>
                  </div>

                  {/* Campos obligatorios */}
                  {requiredFields.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1">Obligatorios</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {requiredFields.map(field => (
                          <div key={field.key} className="flex flex-col gap-1.5 p-3 rounded-lg bg-secondary/30 border border-border/40">
                            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              <span className="w-3.5 h-3.5 rounded border border-red-500/50 bg-red-500/10 flex items-center justify-center shrink-0">
                                <CheckCircle className="w-2.5 h-2.5 text-red-400" />
                              </span>
                              {field.label}
                              <span className="text-red-500 font-bold">*</span>
                            </label>
                            <select
                              value={columnMapping[field.key] || ''}
                              onChange={e => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                              className="input-field cursor-pointer text-xs"
                            >
                              <option value="">-- Seleccionar columna --</option>
                              {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Campos opcionales */}
                  {optionalFields.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-1">Opcionales</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {optionalFields.map(field => {
                          const enabled = enabledOptionalKeys.has(field.key)
                          return (
                            <div
                              key={field.key}
                              className={`flex flex-col gap-1.5 p-3 rounded-lg border transition-all ${enabled ? 'bg-secondary/30 border-border/40' : 'bg-secondary/10 border-border/20 opacity-50'}`}
                            >
                              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5 cursor-pointer select-none" onClick={() => toggleOptionalField(field.key)}>
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${enabled ? 'bg-brand-500 border-brand-500' : 'border-border bg-secondary/40'}`}>
                                  {enabled && <CheckCircle className="w-2.5 h-2.5 text-white" />}
                                </div>
                                {field.label}
                              </label>
                              {enabled && (
                                <select
                                  value={columnMapping[field.key] || ''}
                                  onChange={e => setColumnMapping({ ...columnMapping, [field.key]: e.target.value })}
                                  className="input-field cursor-pointer text-xs"
                                >
                                  <option value="">-- Ignorar / No Mapeado --</option>
                                  {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button onClick={() => setStep(2)} className="btn-secondary px-4 py-2">Atrás</button>
                    <button
                      onClick={applyColumnMapping}
                      disabled={validateMutation.isPending}
                      className="btn-primary px-6 py-2 flex items-center gap-1.5"
                    >
                      {validateMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Verificando en BD...</>
                        : <>Validar y Continuar <ArrowRight className="w-4 h-4" /></>
                      }
                    </button>
                  </div>
                </>
              )}

              {/* Fase B: Resumen de validación */}
              {step3Phase === 'summary' && step3Summary && (
                <>
                  <div className="p-4 bg-secondary/20 border border-border/60 rounded-xl">
                    <h4 className="text-sm font-bold text-foreground mb-1">Resultado de Verificación</h4>
                    <p className="text-xs text-muted-foreground">
                      Se verificaron {csvRows.length} registros contra la base de datos. Revisa el resumen antes de continuar.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-center">
                      <span className="block text-2xl font-bold text-emerald-400 font-mono">{step3Summary.valid}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Listos para importar</span>
                    </div>
                    <div className={`p-4 border rounded-xl text-center ${step3Summary.duplicates > 0 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-secondary/20 border-border/30'}`}>
                      <span className={`block text-2xl font-bold font-mono ${step3Summary.duplicates > 0 ? 'text-amber-400' : 'text-muted-foreground'}`}>{step3Summary.duplicates}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Ya existen en el sistema</span>
                    </div>
                    <div className={`p-4 border rounded-xl text-center ${step3Summary.otherErrors > 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-secondary/20 border-border/30'}`}>
                      <span className={`block text-2xl font-bold font-mono ${step3Summary.otherErrors > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>{step3Summary.otherErrors}</span>
                      <span className="text-xs text-muted-foreground mt-1 block">Con errores de datos</span>
                    </div>
                  </div>

                  {step3Summary.duplicates > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold">{step3Summary.duplicates} cliente{step3Summary.duplicates > 1 ? 's' : ''} ya {step3Summary.duplicates > 1 ? 'están registrados' : 'está registrado'} en el sistema</span> y {step3Summary.duplicates > 1 ? 'serán omitidos' : 'será omitido'} automáticamente. Puedes continuar si deseas importar únicamente los {step3Summary.valid} registros válidos.
                      </span>
                    </div>
                  )}

                  {step3Summary.valid === 0 && (
                    <div className="flex items-start gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg text-xs text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="font-semibold">No hay registros válidos para importar. Revisa el mapeo de columnas y corrige los errores.</span>
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button onClick={() => setStep3Phase('mapping')} className="btn-secondary px-4 py-2">Revisar Mapeo</button>
                    <button
                      onClick={() => proceedToStep4(validationResult)}
                      disabled={step3Summary.valid === 0}
                      className="btn-primary px-6 py-2 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      Continuar con {step3Summary.valid} registros <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── PASO 4: Validar y Previsualizar ── */}
          {step === 4 && validationResult && (
            <div className="space-y-5">

              {/* Fase A: Mapeo de planes */}
              {step4Phase === 'plan-mapping' && (
                <>
                  <div className="p-4 bg-secondary/20 border border-border/60 rounded-xl">
                    <h4 className="text-sm font-bold text-foreground mb-1">Mapeo de Planes Detectados</h4>
                    <p className="text-xs text-muted-foreground">
                      Asocia los planes encontrados en tu CSV con los planes registrados en el sistema.
                    </p>
                  </div>
                  <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                    {validationResult.detected_plans.map((name: string) => (
                      <div key={name} className="flex items-center justify-between gap-4 p-2.5 rounded-lg bg-secondary/30 border border-border/40 text-xs">
                        <span className="font-semibold text-foreground font-mono">{name || '(Vacío)'}</span>
                        <select
                          value={planMappings[name] || ''}
                          onChange={e => setPlanMappings({ ...planMappings, [name]: e.target.value })}
                          className="input-field w-64 text-xs cursor-pointer"
                        >
                          <option value="">-- No asignar plan --</option>
                          {dbPlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button onClick={() => setStep(3)} className="btn-secondary px-4 py-2">Atrás</button>
                    <button
                      onClick={runFinalValidation}
                      disabled={revalidateMutation.isPending}
                      className="btn-primary px-6 py-2 flex items-center gap-1.5"
                    >
                      {revalidateMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Validando...</>
                        : <>Validar Datos <ArrowRight className="w-4 h-4" /></>
                      }
                    </button>
                  </div>
                </>
              )}

              {/* Fase B: Previsualización */}
              {step4Phase === 'preview' && (
                <>
                  <div className="flex items-center justify-between p-4 bg-secondary/20 border border-border/60 rounded-xl">
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Previsualización del Lote</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">Las filas con errores serán omitidas en la importación.</p>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <div className="text-center bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                        <span className="block font-bold text-emerald-400 text-base">{validationResult.valid_rows}</span>
                        <span className="text-[10px] text-muted-foreground">Válidos</span>
                      </div>
                      <div className="text-center bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-lg">
                        <span className="block font-bold text-red-400 text-base">{validationResult.invalid_rows}</span>
                        <span className="text-[10px] text-muted-foreground">Errores</span>
                      </div>
                    </div>
                  </div>

                  {assignCoordinates && gatewayHasCoords && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-brand-500/5 border border-brand-500/20 rounded-lg text-xs text-brand-300">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      Se asignarán coordenadas aleatorias dentro de 1km de <span className="font-semibold ml-1">{selectedGateway?.name}</span> a cada cliente importado.
                    </div>
                  )}

                  <div className="border border-border/60 rounded-xl overflow-hidden">
                    <div className="max-h-[30vh] overflow-y-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-secondary border-b border-border/60 text-muted-foreground uppercase font-bold text-[10px] sticky top-0 z-10">
                          <tr>
                            <th className="p-3 w-14">Fila</th>
                            <th className="p-3 w-48">Cliente</th>
                            <th className="p-3 w-32">Cédula</th>
                            <th className="p-3">Estado / Errores</th>
                            <th className="p-3 w-10" aria-label="Seleccionar">
                              <input
                                type="checkbox"
                                title="Seleccionar todos los válidos"
                                checked={allValidSelected}
                                ref={el => { if (el) el.indeterminate = !allValidSelected && someValidSelected }}
                                onChange={toggleAllValid}
                                className="w-3.5 h-3.5 rounded cursor-pointer accent-brand-500"
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {validationResult.rows.map((row: any) => (
                            <tr
                              key={row.index}
                              className={`transition-opacity ${row.valid
                                ? selectedRowIndexes.has(row.index)
                                  ? 'hover:bg-emerald-500/5'
                                  : 'opacity-40 hover:opacity-60'
                                : 'bg-red-500/5 hover:bg-red-500/10'
                              }`}
                            >

                              <td className="p-3 text-muted-foreground font-mono">{row.index + 1}</td>
                              <td className="p-3 font-semibold text-foreground">{row.data.nombre || '—'}</td>
                              <td className="p-3 font-mono text-muted-foreground">{row.data.cedula || '—'}</td>
                              <td className="p-3">
                                {row.valid ? (
                                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                    <CheckCircle className="w-3.5 h-3.5" /> Listo
                                  </span>
                                ) : (
                                  <div className="text-red-400 space-y-0.5">
                                    {row.errors.map((err: string, i: number) => (
                                      <p key={i} className="flex items-start gap-1"><span>•</span><span>{err}</span></p>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="p-3">
                                <input
                                  type="checkbox"
                                  title={row.valid ? 'Incluir en importación' : 'Fila con errores — no se puede seleccionar'}
                                  checked={selectedRowIndexes.has(row.index)}
                                  disabled={!row.valid}
                                  onChange={() => toggleRowSelection(row.index)}
                                  className="w-3.5 h-3.5 rounded cursor-pointer accent-brand-500 disabled:cursor-not-allowed disabled:opacity-30"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button
                      onClick={() => validationResult.detected_plans.length > 0 ? setStep4Phase('plan-mapping') : setStep(3)}
                      disabled={importMutation.isPending}
                      className="btn-secondary px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Atrás
                    </button>
                    <button
                      onClick={handleImportCommit}
                      disabled={importMutation.isPending || selectedRowIndexes.size === 0}
                      className="btn-primary bg-emerald-600 hover:bg-emerald-700 px-6 py-2 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {importMutation.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Importando...</>
                        : <>Importar {selectedRowIndexes.size} Clientes <CheckCircle className="w-4 h-4" /></>
                      }
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── PASO 5: Resultado final ── */}
          {step === 5 && importResult && (
            <div className="space-y-6 py-4 text-center flex flex-col items-center">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center border ${importResult.sync_pending_count > 0 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                <CheckCircle className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-foreground">Importación Finalizada</h4>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  El proceso de importación masiva se completó. A continuación se detalla el resultado:
                </p>
              </div>
              <div className={`grid gap-4 w-full max-w-md ${importResult.sync_pending_count > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                  <span className="block text-2xl font-bold text-emerald-400 font-mono">{importResult.imported_count}</span>
                  <span className="text-xs text-muted-foreground">Importados</span>
                </div>
                {importResult.sync_pending_count > 0 && (
                  <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                    <span className="block text-2xl font-bold text-amber-400 font-mono">{importResult.sync_pending_count}</span>
                    <span className="text-xs text-muted-foreground">Sync pendiente</span>
                  </div>
                )}
                <div className="p-4 bg-secondary/30 border border-border/40 rounded-xl">
                  <span className="block text-2xl font-bold text-red-400 font-mono">{importResult.failed_count}</span>
                  <span className="text-xs text-muted-foreground">Fallidos</span>
                </div>
              </div>

              {importResult.sync_pending_count > 0 && (
                <div className="w-full flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl text-left">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300">
                    <span className="font-semibold block mb-0.5">
                      {importResult.sync_pending_count} cliente{importResult.sync_pending_count > 1 ? 's fueron guardados' : ' fue guardado'} en la base de datos pero la sincronización con MikroTik quedó pendiente.
                    </span>
                    Cuando el gateway restablezca la conexión, la sincronización se ejecutará automáticamente. También puedes lanzarla manualmente desde la página del gateway → <span className="font-semibold">Sync Pendiente</span>.
                  </div>
                </div>
              )}

              {importResult.failed_count > 0 && (
                <div className="w-full text-left bg-red-500/5 border border-red-500/10 rounded-xl p-4 space-y-2 max-h-[25vh] overflow-y-auto">
                  <h5 className="text-xs font-bold text-red-400 flex items-center gap-1.5 uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4" /> No pudieron importarse
                  </h5>
                  <div className="divide-y divide-border/20 text-xs">
                    {importResult.failures.map((f: any, i: number) => (
                      <div key={i} className="py-2 flex justify-between gap-4">
                        <span className="font-semibold text-foreground">{f.name} {f.cedula}</span>
                        <span className="text-red-400 font-medium">{f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={onClose} className="btn-primary px-8 py-2.5 mt-2">Cerrar Asistente</button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
