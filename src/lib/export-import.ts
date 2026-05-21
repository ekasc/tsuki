const EXPORT_KEYS = [
  'tsuki-weebcentral-library.v2',
  'tsuki-weebcentral-library.v1',
  'tsuki-reading-history.v1',
  'tsuki-remote-progress.v1',
  'tsuki-theme-mode.v1',
  'tsuki-home-onboarding-dismissed.v1',
] as const

export interface ExportData {
  version: 1
  exportedAt: number
  entries: Array<{
    key: string
    value: string
  }>
}

export function exportAllData(): ExportData {
  const entries: ExportData['entries'] = []

  for (const key of EXPORT_KEYS) {
    const value = window.localStorage.getItem(key)
    if (value !== null) {
      entries.push({ key, value })
    }
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    entries,
  }
}

export function downloadExport(data: ExportData) {
  const date = new Date(data.exportedAt)
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tsuki-backup-${dateStr}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function validateImportData(data: unknown): data is ExportData {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  if (d.version !== 1) return false
  if (!Array.isArray(d.entries)) return false
  return d.entries.every(
    (e: unknown) =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as Record<string, unknown>).key === 'string' &&
      typeof (e as Record<string, unknown>).value === 'string',
  )
}

export function importData(data: ExportData): number {
  let count = 0

  for (const entry of data.entries) {
    window.localStorage.setItem(entry.key, entry.value)
    count++
  }

  return count
}
