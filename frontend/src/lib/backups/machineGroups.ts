/** Client-safe grouping for browsing PBS history, including file-level host backups.
 * A PBS connection is the outer scope; names are labels, never identity.
 * Keep original rows intact so every action receives the exact restore point.
 */
export function groupBackupMachines<T extends {
  datastore: string; namespace: string; backupType: string; backupId: string
  vmName: string; backupTime: number
}>(backups: T[]) {
  const buckets = new Map<string, T[]>()
  for (const backup of backups) {
    const key = JSON.stringify([backup.datastore, backup.namespace || '', backup.backupType, backup.backupId])
    const points = buckets.get(key) || []
    points.push(backup)
    buckets.set(key, points)
  }
  return Array.from(buckets, ([key, points]) => {
    points.sort((a, b) => b.backupTime - a.backupTime)
    const vmName = points.find(point => point.vmName?.trim())?.vmName || ''
    return { key, vmName, points, latest: points[0] }
  }).sort((a, b) =>
    (a.vmName || a.latest.backupId).localeCompare(b.vmName || b.latest.backupId, undefined, { numeric: true }) ||
    a.key.localeCompare(b.key)
  )
}
