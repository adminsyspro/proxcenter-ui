// What a clone still does once its Proxmox task ended (roadmap#265): the
// IPAM addresses and MACs of managed NICs, the storage-tier QoS stamp and
// the HA registration run in after() blocks of the clone route. An API
// client that writes the config as soon as the task ends would race them.
// The config read reports `provisioning` while one of them runs, and the
// failures once they are over. In memory, like the vDC reservations: a
// restart forgets it (the state then reads as done), and an entry whose end
// is never seen expires. Kept on globalThis for the same reason as the vDC lock.

export type ProvisioningState = { state: "running" | "failed"; failures: string[] }

type Entry = { pending: Set<string>; failures: string[]; expires: number }

/** How long an entry lives at most: a step whose end is never seen frees it. */
export const PROVISIONING_TTL_MS = 2 * 60 * 60_000

const g = globalThis as { __pcGuestProvisioning?: Map<string, Entry> }
const store = (g.__pcGuestProvisioning ??= new Map<string, Entry>())

const keyOf = (connectionId: string, vmid: string) => `${connectionId}:${vmid}`

/**
 * Opens the steps a guest still goes through; the returned function closes
 * one, with the error it failed on if any. A guest whose steps all succeeded
 * is forgotten; one with a failure keeps it until the entry expires.
 */
export function beginProvisioning(
  connectionId: string,
  vmid: string,
  steps: string[],
  opts: { ttlMs?: number; now?: number } = {},
): (step: string, error?: string) => void {
  const key = keyOf(connectionId, vmid)
  if (steps.length === 0) return () => {}
  const entry: Entry = { pending: new Set(steps), failures: [], expires: (opts.now ?? Date.now()) + (opts.ttlMs ?? PROVISIONING_TTL_MS) }
  store.set(key, entry)
  return (step, error) => {
    if (!entry.pending.delete(step)) return
    if (error) entry.failures.push(`${step}: ${error}`)
    if (entry.pending.size === 0 && entry.failures.length === 0 && store.get(key) === entry) store.delete(key)
  }
}

/** Where the guest stands, or null when nothing runs nor failed. */
export function provisioningState(connectionId: string, vmid: string, now = Date.now()): ProvisioningState | null {
  const key = keyOf(connectionId, vmid)
  const entry = store.get(key)
  if (!entry) return null
  if (entry.expires <= now) {
    store.delete(key)
    return null
  }
  return { state: entry.pending.size > 0 ? "running" : "failed", failures: [...entry.failures] }
}

/** Test seam. */
export function resetGuestProvisioning(): void {
  store.clear()
}
