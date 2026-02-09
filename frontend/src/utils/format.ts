/**
 * Format bytes to human-readable string (binary: 1024-based)
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B'
  if (!bytes || isNaN(bytes)) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * Format bytes for storage display (decimal: 1000-based)
 */
export function formatStorageSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B'
  if (!bytes || isNaN(bytes)) return '0 B'
  const k = 1000
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * Format seconds to human-readable uptime
 */
export function formatUptime(seconds: number): string {
  if (!seconds || seconds < 0) return '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
