import { isFileBasedStorage } from '@/lib/proxmox/storage'

type NodeStorage = {
  storage: string
  type: string
  content?: string
  active?: number
  enabled?: number
}

/** Only use an existing import area. Selection must not depend on PVE's
 *  unordered storage response or change the cluster's storage configuration. */
export function selectDownloadStorage(storages: NodeStorage[], target: string, writable: Set<string> | null): string | null {
  const candidates = storages.filter(s =>
    isFileBasedStorage(s.type) && s.active === 1 && s.enabled === 1 &&
    (!writable || writable.has(s.storage)) &&
    String(s.content || '').split(',').some(c => c.trim() === 'import'),
  )
  if (candidates.some(s => s.storage === target)) return target
  return candidates.map(s => s.storage).sort()[0] ?? null
}
