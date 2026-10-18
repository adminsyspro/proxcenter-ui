/**
 * Exact disk size of the VMs of a bulk migration (roadmap#53), read the way
 * the engines read it at planning time: the sum of the virtual disks'
 * capacity (the "need 3.0 GB" of their space check), through vSphere SOAP for
 * VMware (ESXi and vCenter) and XAPI for a direct XCP-ng pool. The batch
 * space check blocks only on these figures: an estimate that overstates the
 * need would refuse a batch the engines accept.
 *
 * One session per source, a few VMs at a time, a short deadline: a VM whose
 * size cannot be read in time (or a source type with no such read: Hyper-V,
 * Nutanix, XCP-ng through Xen Orchestra) maps to null, and the caller falls
 * back to the list's estimate without blocking.
 */
import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { soapGetVmConfig, soapLogin, soapLogout, parseVmConfig } from "@/lib/vmware/soap"
import { xapiGetVmConfig, xapiLogin, xapiLogout } from "@/lib/xcpng/xapi-client"
import { splitCreds, xcpngSubTypeOf } from "@/lib/xcpng/source"
import { isValidSourceVmId } from "@/lib/migration/source-vm-id"

export const SIZE_READ_CONCURRENCY = 4
export const SIZE_READ_DEADLINE_MS = 15_000

export interface SizeReadDeps {
  vmwareSizes?: (conn: SourceConn, vmIds: string[], deadline: number) => Promise<Map<string, number | null>>
  xcpngSizes?: (conn: SourceConn, vmIds: string[], deadline: number) => Promise<Map<string, number | null>>
  now?: () => number
}

interface SourceConn { type: string; subType: string | null; baseUrl: string; apiTokenEnc: string | null; insecureTLS: boolean }

/** Run `fn` over `items`, `limit` at a time, never past `deadline` (epoch ms): late items get null. */
export async function mapBounded<T, R>(items: T[], limit: number, deadline: number, fn: (item: T) => Promise<R>, now: () => number = Date.now): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      const left = deadline - now()
      if (left <= 0) return
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        out[i] = await Promise.race([
          fn(items[i]),
          new Promise<null>(res => { timer = setTimeout(() => res(null), left) }),
        ])
      } catch {
        out[i] = null
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function vmwareSizes(conn: SourceConn, vmIds: string[], deadline: number): Promise<Map<string, number | null>> {
  const creds = decryptSecret(conn.apiTokenEnc!)
  const i = creds.indexOf(":")
  const session = await soapLogin(conn.baseUrl.replace(/\/$/, ""), i > 0 ? creds.slice(0, i) : "root", i > 0 ? creds.slice(i + 1) : creds, conn.insecureTLS)
  try {
    const sizes = await mapBounded(vmIds, SIZE_READ_CONCURRENCY, deadline, async id =>
      isValidSourceVmId(id) ? parseVmConfig(await soapGetVmConfig(session, id)).disks.reduce((s, d) => s + (d.capacityBytes || 0), 0) : null)
    return new Map(vmIds.map((id, k) => [id, sizes[k]]))
  } finally {
    await soapLogout(session).catch(() => {})
  }
}

async function xcpngSizes(conn: SourceConn, vmIds: string[], deadline: number): Promise<Map<string, number | null>> {
  const { user, password } = splitCreds(decryptSecret(conn.apiTokenEnc!), "root")
  const session = await xapiLogin(conn.baseUrl, user, password, conn.insecureTLS)
  try {
    const sizes = await mapBounded(vmIds, SIZE_READ_CONCURRENCY, deadline, async id =>
      isValidSourceVmId(id) ? (await xapiGetVmConfig(session, id)).disks.reduce((s, d) => s + (d.sizeBytes || 0), 0) : null)
    return new Map(vmIds.map((id, k) => [id, sizes[k]]))
  } finally {
    await xapiLogout(session).catch(() => {})
  }
}

/** Exact bytes per source VM id, null where it could not be read. Never throws. */
export async function readBatchDiskSizes(tenantId: string, sourceConnectionId: string, vmIds: string[], deps: SizeReadDeps = {}): Promise<Map<string, number | null>> {
  const unknown = () => new Map<string, number | null>(vmIds.map(id => [id, null]))
  const now = deps.now ?? Date.now
  const deadline = now() + SIZE_READ_DEADLINE_MS
  try {
    const conn = await getTenantPrisma(tenantId).connection.findUnique({
      where: { id: sourceConnectionId },
      select: { type: true, subType: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true },
    }) as SourceConn | null
    if (!conn?.apiTokenEnc) return unknown()
    if (conn.type === "vmware") return await (deps.vmwareSizes ?? vmwareSizes)(conn, vmIds, deadline)
    if (conn.type === "xcpng" && xcpngSubTypeOf(conn) === "xapi") return await (deps.xcpngSizes ?? xcpngSizes)(conn, vmIds, deadline)
    return unknown()
  } catch {
    return unknown()
  }
}
