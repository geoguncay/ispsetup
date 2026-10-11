/** Formatea un límite de cola (ej. "10M/20M") a texto legible ("↑ 10 MB / ↓ 20 MB"). */
export function formatQueueLimit(maxLimit: string | undefined): string {
  if (!maxLimit || maxLimit === '0/0') return 'Ilimitado'
  const parts = maxLimit.split('/')
  if (parts.length !== 2) return maxLimit

  const formatPart = (valStr: string): string => {
    valStr = valStr.toUpperCase().trim()
    if (valStr.endsWith('G')) {
      return `${valStr.slice(0, -1)} GB`
    }
    if (valStr.endsWith('M')) {
      return `${valStr.slice(0, -1)} MB`
    }
    if (valStr.endsWith('K')) {
      return `${valStr.slice(0, -1)} KB`
    }
    const num = Number(valStr)
    if (!isNaN(num) && num > 0) {
      if (num >= 1024 * 1024 * 1024) {
        return `${(num / (1024 * 1024 * 1024)).toFixed(0)} GB`
      }
      if (num >= 1024 * 1024) {
        return `${(num / (1024 * 1024)).toFixed(0)} MB`
      }
      if (num >= 1024) {
        return `${(num / 1024).toFixed(0)} KB`
      }
      return `${num} B`
    }
    return valStr
  }

  return `↑ ${formatPart(parts[0])} / ↓ ${formatPart(parts[1])}`
}

/** Formatea bytes crudos a MB / GB / TB. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(2)} TB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}
