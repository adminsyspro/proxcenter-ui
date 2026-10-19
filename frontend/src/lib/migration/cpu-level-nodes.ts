import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { missingFlagsForLevel, x86LevelFromFlags } from "./cpu-level"

/** One node of the target cluster and the highest x86-64 level its CPU runs (#1000). */
export interface NodeCpuLevel {
  node: string
  /** 1 to 4; null when the node did not answer (offline), so nothing is claimed about it. */
  level: number | null
  /** Flags missing for x86-64-v3, for the message. */
  missingV3: string[]
}

/**
 * The x86-64 level of every node of the target cluster, from the CPU flags
 * PVE reports (`/nodes/<n>/status`, cpuinfo.flags). A VM created with
 * x86-64-v3 cannot start, nor be migrated, on a node below that level, so the
 * migration dialog warns when the cluster has one. Never throws.
 */
export async function readClusterCpuLevels(connectionId: string): Promise<NodeCpuLevel[]> {
  const conn = await getConnectionById(connectionId)
  const nodes = await pveFetch<Array<{ node: string; status?: string }>>(conn as any, "/nodes").catch(() => [])
  return Promise.all((nodes || []).map(async n => {
    if (n.status && n.status !== "online") return { node: n.node, level: null, missingV3: [] }
    try {
      const st = await pveFetch<{ cpuinfo?: { flags?: string } }>(conn as any, `/nodes/${encodeURIComponent(n.node)}/status`)
      const flags = st?.cpuinfo?.flags
      if (!flags) return { node: n.node, level: null, missingV3: [] }
      return { node: n.node, level: x86LevelFromFlags(flags), missingV3: missingFlagsForLevel(flags, 3) }
    } catch {
      return { node: n.node, level: null, missingV3: [] }
    }
  }))
}
