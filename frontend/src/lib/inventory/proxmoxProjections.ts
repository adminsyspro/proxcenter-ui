// PURE readers of raw Proxmox payloads, extracted from the inventory fan-out
// (#925).
//
// `fetchRawInventory` is a 772-line orchestration of network calls, Prisma
// reads and a tenant scope, and it sits at 22 per cent line coverage because
// exercising it means mocking all of that. The parsing inside it is not
// orchestration: it is a pure transformation of a JSON payload into our own
// shape, it carries the awkward details Proxmox actually returns, and it is
// exactly the part a reader will get wrong. So it lives here, with tests.
import type { RawStorageEntry } from "@/lib/proxmox/storage"

/** What `/nodes/{node}/status` gives us, once read. */
export type NodeStatusFacts = {
  /** Bytes, from `memory`, which excludes the ZFS ARC and kernel caches. */
  mem?: number
  maxmem?: number
  /** One, five and fifteen minute load, in that order. Empty when absent. */
  loadavg?: number[]
  iowait?: number
  swapUsed?: number
  swapTotal?: number
  rootfsUsed?: number
  rootfsTotal?: number
  cores?: number
  pveVersion?: string
  kernel?: string
}

/**
 * Reads the parts of a node status payload the inventory keeps.
 *
 * Measured on PVE 9.2.11, the payload carries `current-kernel`, `kversion`,
 * `uptime`, `cpu`, `swap`, `memory`, `pveversion`, `cpuinfo`, `wait`,
 * `loadavg`, `idle`, `boot-info`, `rootfs` and `ksm`. Two details a reader
 * gets wrong:
 *
 *   - **`loadavg` is an array of STRINGS**, `["0.61", "0.55", "0.49"]`, so it
 *     is parsed rather than passed through. A non-numeric entry is dropped
 *     rather than published as NaN, which would make Prometheus reject the
 *     whole scrape.
 *   - a capacity of 0 means the node reports none, so `memory`, `swap` and
 *     `rootfs` are only read when their total is positive. Returning 0/0
 *     instead would make every ratio downstream divide by zero.
 */
export function readNodeStatus(status: unknown): NodeStatusFacts {
  const payload = (status ?? {}) as Record<string, any>
  const facts: NodeStatusFacts = {}

  if (Number(payload.memory?.total) > 0) {
    facts.mem = Number(payload.memory.used || 0)
    facts.maxmem = Number(payload.memory.total || 0)
  }
  if (Array.isArray(payload.loadavg)) {
    const parsed = payload.loadavg.slice(0, 3).map(Number).filter(Number.isFinite)
    if (parsed.length > 0) facts.loadavg = parsed
  }
  if (typeof payload.wait === "number" && Number.isFinite(payload.wait)) {
    facts.iowait = payload.wait
  }
  if (Number(payload.swap?.total) > 0) {
    facts.swapUsed = Number(payload.swap.used || 0)
    facts.swapTotal = Number(payload.swap.total || 0)
  }
  if (Number(payload.rootfs?.total) > 0) {
    facts.rootfsUsed = Number(payload.rootfs.used || 0)
    facts.rootfsTotal = Number(payload.rootfs.total || 0)
  }
  if (typeof payload.cpuinfo?.cpus === "number") {
    facts.cores = payload.cpuinfo.cpus
  }
  if (typeof payload.pveversion === "string" && payload.pveversion !== "") {
    facts.pveVersion = payload.pveversion
  }
  const kernel = payload["current-kernel"]?.release
  if (typeof kernel === "string" && kernel !== "") {
    facts.kernel = kernel
  }

  return facts
}

/**
 * Turns `/cluster/resources?type=storage` rows into the shape
 * `aggregateStorage` consumes.
 *
 * The aggregation is deliberately NOT done here: a shared storage appears
 * once per node upstream, and collapsing that is `aggregateStorage`'s job,
 * already written and tested. This only reads the payload, where two fields
 * are not what their name suggests: the space figures arrive as `disk` and
 * `maxdisk`, not `used` and `total`, and the plugin name is `plugintype`,
 * with `type` carrying the resource kind.
 */
export function readStorageResources(
  rows: unknown,
  connId: string,
  connName: string,
): RawStorageEntry[] {
  if (!Array.isArray(rows)) return []

  return rows
    .filter((row: any) => row?.storage)
    .map((row: any) => ({
      connId,
      connName,
      node: String(row.node ?? ""),
      storage: String(row.storage),
      type: String(row.plugintype || row.type || "unknown"),
      shared: row.shared,
      used: Number(row.disk || 0),
      total: Number(row.maxdisk || 0),
      content: typeof row.content === "string" ? row.content.split(",") : undefined,
      // `unknown` is what Proxmox reports for a storage it could not reach,
      // which is not the same thing as one an operator disabled, but both
      // mean "do not plan against this capacity".
      enabled: row.status !== "unknown" && row.status !== "disabled",
      status: row.status,
    }))
}
