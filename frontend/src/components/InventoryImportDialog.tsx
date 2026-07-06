/**
 * InventoryImportDialog — Modal para importar artículos de inventario desde un archivo CSV.
 * Incluye descarga de plantilla CSV, vista previa de datos, y ejecución de importación.
 */
import { useState, useRef, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  X, Upload, Download, FileSpreadsheet, Loader2,
  CheckCircle2, AlertTriangle, XCircle, FileText, Trash2
} from 'lucide-react'
import api from '@/services/api'

interface InventoryImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface ParsedRow {
  [key: string]: string
}

interface ImportResult {
  success: boolean
  total: number
  imported_count: number
  failed_count: number
  successes: { row: number; code: string; name: string }[]
  failures: { row: number; code: string; name: string; errors: string[] }[]
}

// CSV template columns matching the inventory model
const TEMPLATE_COLUMNS = [
  'nombre',
  'codigo',
  'modelo',
  'categoria',
  'cantidad',
  'minimo_alerta',
  'precio_compra',
  'precio_venta',
  'proveedor',
  'descripcion',
]

const TEMPLATE_EXAMPLE_ROW = [
  'Router Mikrotik hAP ac2',
  'MTK-HAPAC2',
  'hAP ac2',
  'Router',
  '10',
  '3',
  '55.00',
  '85.00',
  'MikroTik Distribuidor',
  'Router doble banda 2.4/5GHz con 5 puertos gigabit',
]

const CATEGORY_OPTIONS = ['Router', 'Antena', 'ONT', 'ONU', 'Cable', 'Consumible', 'Herramienta', 'Otro']

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split(/\r\n|\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Detect delimiter (comma or semicolon)
  const firstLine = lines[0]
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.every(v => !v)) continue // skip empty rows

    const row: ParsedRow = {}
    headers.forEach((header, idx) => {
      row[header] = values[idx] || ''
    })
    rows.push(row)
  }

  return rows
}

function downloadTemplate() {
  const bom = '\uFEFF'
  const header = TEMPLATE_COLUMNS.join(',')
  const example = TEMPLATE_EXAMPLE_ROW.map(v => `"${v}"`).join(',')
  const csvContent = bom + header + '\n' + example + '\n'
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla_inventario.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

type Step = 'upload' | 'preview' | 'result'

export function InventoryImportDialog({ isOpen, onClose, onSuccess }: InventoryImportDialogProps) {
  const [step, setStep] = useState<Step>('upload')
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [dragOver, setDragOver] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetState = () => {
    setStep('upload')
    setParsedRows([])
    setFileName('')
    setDragOver(false)
    setImportResult(null)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Por favor seleccione un archivo .csv')
      return
    }
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const rows = parseCSV(text)
      if (rows.length === 0) {
        alert('El archivo CSV no contiene datos válidos.')
        return
      }
      setParsedRows(rows)
      setStep('preview')
    }
    reader.readAsText(file, 'UTF-8')
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const importMutation = useMutation({
    mutationFn: async (rows: ParsedRow[]) => {
      const { data } = await api.post('/inventory/import', rows)
      return data as ImportResult
    },
    onSuccess: (result) => {
      setImportResult(result)
      setStep('result')
      if (result.imported_count > 0) {
        onSuccess()
      }
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail ?? 'Error al importar inventario')
    }
  })

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="glass-card w-full max-w-4xl shadow-2xl relative flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-400" />
            <span>Asistente de Importación de  Inventario</span>
          </h3>
          <button
            onClick={handleClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${step === 'upload'
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
                : 'bg-secondary/40 text-muted-foreground'
              }`}>
              <Upload className="w-3 h-3" /> 1. Subir archivo
            </span>
            <span className="text-muted-foreground/30">→</span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${step === 'preview'
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
                : 'bg-secondary/40 text-muted-foreground'
              }`}>
              <FileText className="w-3 h-3" /> 2. Vista previa
            </span>
            <span className="text-muted-foreground/30">→</span>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all ${step === 'result'
                ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
                : 'bg-secondary/40 text-muted-foreground'
              }`}>
              <CheckCircle2 className="w-3 h-3" /> 3. Resultado
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 pb-0">
          {/* ───── STEP 1: UPLOAD ───── */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${dragOver
                    ? 'border-brand-400 bg-brand-500/10 scale-[1.01]'
                    : 'border-border hover:border-brand-400/50 hover:bg-secondary/30'
                  }`}
              >
                <Upload className={`w-12 h-12 mx-auto mb-3 transition-colors ${dragOver ? 'text-brand-400' : 'text-muted-foreground'
                  }`} />
                <p className="text-sm font-semibold text-foreground mb-1">
                  Arrastra tu archivo CSV aquí
                </p>
                <p className="text-xs text-muted-foreground">
                  o haz clic para seleccionar el archivo
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFile(file)
                  }}
                />
              </div>

              {/* Template download */}
              <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-secondary/20 border border-border/60 rounded-xl">
                <div className="flex items-start gap-3">
                  <Download className="w-4 h-4 text-brand-400" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground mb-1">Plantilla CSV</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Descarga nuestra plantilla estructurada con ejemplos prácticos para asegurar que tus datos tengan el formato requerido por la plataforma.
                    </p>
                  </div>
                  <button
                      onClick={downloadTemplate}
                      className="btn-secondary w-full sm:w-auto px-4 py-2 shrink-0 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Descargar Plantilla CSV
                    </button>
                </div>
              </div>
            </div>
          )}

          {/* ───── STEP 2: PREVIEW ───── */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-foreground">{fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    — {parsedRows.length} {parsedRows.length === 1 ? 'artículo' : 'artículos'} detectados
                  </span>
                </div>
                <button
                  onClick={() => { resetState() }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Cambiar archivo
                </button>
              </div>

              {/* Preview table */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Nombre</th>
                      <th>Código/SKU</th>
                      <th>Modelo</th>
                      <th>Categoría</th>
                      <th>Cant.</th>
                      <th>Mín. Alerta</th>
                      <th>P. Compra</th>
                      <th>P. Venta</th>
                      <th>Proveedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-secondary/40 transition-colors">
                        <td className="text-muted-foreground font-mono">{idx + 1}</td>
                        <td className="font-semibold text-foreground max-w-[160px] truncate">{row.nombre || <span className="text-red-400 italic">vacío</span>}</td>
                        <td className="font-mono text-brand-400">{row.codigo || <span className="text-red-400 italic">vacío</span>}</td>
                        <td>{row.modelo || <span className="text-muted-foreground/40">—</span>}</td>
                        <td>{row.categoria || <span className="text-muted-foreground/40">—</span>}</td>
                        <td className="font-mono">{row.cantidad || '0'}</td>
                        <td className="font-mono">{row.minimo_alerta || '5'}</td>
                        <td className="font-mono">${row.precio_compra || '0.00'}</td>
                        <td className="font-mono">${row.precio_venta || '0.00'}</td>
                        <td>{row.proveedor || <span className="text-muted-foreground/40">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ───── STEP 3: RESULT ───── */}
          {step === 'result' && importResult && (
            <div className="space-y-4">
              {/* Summary card */}
              <div className={`p-5 rounded-xl border ${importResult.failed_count === 0
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : importResult.imported_count === 0
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                <div className="flex items-center gap-3 mb-3">
                  {importResult.failed_count === 0 ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  ) : importResult.imported_count === 0 ? (
                    <XCircle className="w-6 h-6 text-red-400" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-amber-400" />
                  )}
                  <h4 className="text-base font-bold text-foreground">
                    {importResult.failed_count === 0
                      ? '¡Importación completada!'
                      : importResult.imported_count === 0
                        ? 'No se importó ningún artículo'
                        : 'Importación parcial'}
                  </h4>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-background/50 rounded-lg">
                    <p className="text-2xl font-bold text-foreground">{importResult.total}</p>
                    <p className="text-xs text-muted-foreground font-semibold">Total filas</p>
                  </div>
                  <div className="text-center p-3 bg-background/50 rounded-lg">
                    <p className="text-2xl font-bold text-emerald-400">{importResult.imported_count}</p>
                    <p className="text-xs text-muted-foreground font-semibold">Importados</p>
                  </div>
                  <div className="text-center p-3 bg-background/50 rounded-lg">
                    <p className="text-2xl font-bold text-red-400">{importResult.failed_count}</p>
                    <p className="text-xs text-muted-foreground font-semibold">Con errores</p>
                  </div>
                </div>
              </div>

              {/* Failures detail */}
              {importResult.failures.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-bold text-red-400 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" />
                    Errores encontrados
                  </h5>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {importResult.failures.map((f, idx) => (
                      <div key={idx} className="p-3 bg-red-500/5 border border-red-500/15 rounded-lg">
                        <p className="text-xs font-semibold text-foreground mb-1">
                          Fila {f.row}: <span className="text-brand-400 font-mono">{f.code}</span> — {f.name}
                        </p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {f.errors.map((err, eIdx) => (
                            <li key={eIdx} className="text-xs text-red-400">{err}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Successes */}
              {importResult.successes.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Artículos importados ({importResult.successes.length})
                  </h5>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importResult.successes.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 rounded-lg text-xs">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="font-mono text-brand-400">{s.code}</span>
                        <span className="text-foreground">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          {step === 'upload' && (
            <button onClick={handleClose} className="btn-secondary px-4 py-2 cursor-pointer">
              Cancelar
            </button>
          )}

          {step === 'preview' && (
            <>
              <button onClick={resetState} className="btn-secondary px-4 py-2 cursor-pointer">
                Volver
              </button>
              <button
                onClick={() => importMutation.mutate(parsedRows)}
                disabled={importMutation.isPending || parsedRows.length === 0}
                className="btn-primary px-4 py-2 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Importar {parsedRows.length} {parsedRows.length === 1 ? 'artículo' : 'artículos'}
                  </>
                )}
              </button>
            </>
          )}

          {step === 'result' && (
            <button onClick={handleClose} className="btn-primary px-4 py-2 cursor-pointer">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
