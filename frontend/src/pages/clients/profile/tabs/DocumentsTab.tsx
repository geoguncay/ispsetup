import { useState } from 'react'
import { FileText, Download, Trash2, UploadCloud, Loader2 } from 'lucide-react'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatDate } from '@/lib/utils'

/**
 * Documentos del cliente.
 * NOTA: datos de ejemplo y subida simulada, aún sin backend.
 */
export function DocumentsTab() {
  const dateFormat = useDateFormat()
  const [isUploading, setIsUploading] = useState(false)
  const [documents, setDocuments] = useState([
    { id: '1', name: 'Contrato_de_Servicio_ISP.pdf', size: '1.2 MB', date: '2026-05-10' },
    { id: '2', name: 'Cedula_Identidad_Scan.pdf', size: '840 KB', date: '2026-05-10' },
    { id: '3', name: 'Croquis_Instalacion.png', size: '2.4 MB', date: '2026-05-12' },
  ])

  return (
                <div className="space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Documentos del Cliente</h3>
                    <div className="relative">
                      <input
                        type="file"
                        id="file-upload"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setIsUploading(true);
                            setTimeout(() => {
                              setDocuments((prev) => [
                                ...prev,
                                {
                                  id: String(Date.now()),
                                  name: file.name,
                                  size: file.size > 1024 * 1024
                                    ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                                    : `${(file.size / 1024).toFixed(0)} KB`,
                                  date: new Date().toISOString().split('T')[0],
                                }
                              ]);
                              setIsUploading(false);
                            }, 1000);
                          }
                        }}
                      />
                      <label
                        htmlFor="file-upload"
                        className="btn-primary text-xs py-1.5 px-3 h-auto cursor-pointer flex items-center gap-1.5"
                      >
                        {isUploading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UploadCloud className="w-3.5 h-3.5" />
                        )}
                        {isUploading ? 'Subiendo...' : 'Subir Documento'}
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="glass-card p-4 flex items-center justify-between border border-border/40 hover:border-brand-500/20 transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-brand-900/30 rounded-lg flex items-center justify-center border border-brand-800/50">
                            <FileText className="w-5 h-5 text-brand-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground truncate max-w-[180px] sm:max-w-[240px]">
                              {doc.name}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {doc.size} • {formatDate(doc.date, dateFormat)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              alert(`Descargando archivo: ${doc.name}`);
                            }}
                            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            title="Descargar archivo"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
                            }}
                            className="p-1.5 rounded hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
                            title="Eliminar archivo"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {documents.length === 0 && (
                      <div className="col-span-full py-12 text-center border border-dashed border-border rounded-lg">
                        <FileText className="w-12 h-12 mx-auto text-muted-foreground/45 mb-3" />
                        <p className="text-sm font-medium text-foreground">No hay documentos cargados</p>
                        <p className="text-xs text-muted-foreground mt-1">Sube contratos, copias de cédula u otros archivos para este cliente.</p>
                      </div>
                    )}
                  </div>
                </div>
  )
}
