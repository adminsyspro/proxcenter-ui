import { foldEffectiveVlanTags, type HostBridge, type HostVlan } from './hostVlanMap'
import { type SdnVnet } from './sdnVnetMap'

export type VmNetItem = {
  vmid: string
  name: string
  node: string
  type: string
  status: string
  connId: string
  nets: any[]
}

export type HostBridgeItem = HostBridge & { connId: string }
export type HostVlanItem = HostVlan & { connId: string }
export type SdnVnetItem = SdnVnet & { connId: string }

const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 300

async function fetchWithRetry(
  connId: string,
  retries: number,
  retryDelayMs: number,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; items: VmNetItem[]; bridges: HostBridgeItem[]; vlans: HostVlanItem[]; sdnVnets: SdnVnetItem[]; vnetAliases: Record<string, string> } | { ok: false }> {
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
      const bridges: HostBridgeItem[] = (json.bridges ?? []).map((b: HostBridge) => ({
        ...b,
        connId,
      }))
      const vlans: HostVlanItem[] = (json.vlans ?? []).map((v: HostVlan) => ({
        ...v,
        connId,
      }))
      const sdnVnets: SdnVnetItem[] = (json.sdnVnets ?? []).map((v: SdnVnet) => ({
        ...v,
        connId,
      }))
      const vnetAliases: Record<string, string> = json.vnetAliases ?? {}
      return { ok: true, items, bridges, vlans, sdnVnets, vnetAliases }
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
 * retry logic. Returns flat data, flat host bridges, flat host VLAN sub-interfaces
 * and flat SDN VNets (each tagged with connId), plus the list of connection IDs that
 * failed after all retries. Never rejects — partial failure is surfaced via failedConnIds.
 */
export async function fetchConnectionsNetworks(
  connIds: string[],
  opts?: { retries?: number; retryDelayMs?: number; fetchImpl?: typeof fetch },
): Promise<{ data: VmNetItem[]; bridges: HostBridgeItem[]; vlans: HostVlanItem[]; sdnVnets: SdnVnetItem[]; vnetAliasesByConn: Record<string, Record<string, string>>; failedConnIds: string[] }> {
  if (connIds.length === 0) return { data: [], bridges: [], vlans: [], sdnVnets: [], vnetAliasesByConn: {}, failedConnIds: [] }

  const retries = opts?.retries ?? DEFAULT_RETRIES
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const fetchImpl = opts?.fetchImpl ?? fetch

  const results = await Promise.all(
    connIds.map((connId) => fetchWithRetry(connId, retries, retryDelayMs, fetchImpl)),
  )

  const data: VmNetItem[] = []
  const bridges: HostBridgeItem[] = []
  const vlans: HostVlanItem[] = []
  const sdnVnets: SdnVnetItem[] = []
  const vnetAliasesByConn: Record<string, Record<string, string>> = {}
  const failedConnIds: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.ok) {
      data.push(...result.items)
      bridges.push(...result.bridges)
      vlans.push(...result.vlans)
      sdnVnets.push(...result.sdnVnets)
      vnetAliasesByConn[connIds[i]] = result.vnetAliases
    } else {
      failedConnIds.push(connIds[i])
    }
  }

  return { data, bridges, vlans, sdnVnets, vnetAliasesByConn, failedConnIds }
}
