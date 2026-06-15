import { foldEffectiveVlanTags } from './hostVlanMap'

export type VmNetItem = {
  vmid: string
  name: string
  node: string
  type: string
  status: string
  connId: string
  nets: any[]
}

const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 300

async function fetchWithRetry(
  connId: string,
  retries: number,
  retryDelayMs: number,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; items: VmNetItem[] } | { ok: false }> {
  let attempt = 0
  while (attempt <= retries) {
    try {
      const res = await fetchImpl(
        `/api/v1/connections/${encodeURIComponent(connId)}/networks`,
      )
      if (!res.ok) return { ok: false }
      const json = await res.json()
      const items: VmNetItem[] = (json.data ?? []).map((vm: any) => ({
        ...vm,
        connId,
        nets: foldEffectiveVlanTags(vm.nets),
      }))
      return { ok: true, items }
    } catch {
      if (attempt < retries) {
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        }
        attempt++
        continue
      }
      return { ok: false }
    }
  }
  return { ok: false }
}

/**
 * Fetch VM network data from multiple connections concurrently with per-connection
 * retry logic. Returns flat data plus the list of connection IDs that failed after
 * all retries. Never rejects — partial failure is surfaced via failedConnIds.
 */
export async function fetchConnectionsNetworks(
  connIds: string[],
  opts?: { retries?: number; retryDelayMs?: number; fetchImpl?: typeof fetch },
): Promise<{ data: VmNetItem[]; failedConnIds: string[] }> {
  if (connIds.length === 0) return { data: [], failedConnIds: [] }

  const retries = opts?.retries ?? DEFAULT_RETRIES
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const fetchImpl = opts?.fetchImpl ?? fetch

  const results = await Promise.all(
    connIds.map((connId) => fetchWithRetry(connId, retries, retryDelayMs, fetchImpl)),
  )

  const data: VmNetItem[] = []
  const failedConnIds: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.ok) {
      data.push(...result.items)
    } else {
      failedConnIds.push(connIds[i])
    }
  }

  return { data, failedConnIds }
}
