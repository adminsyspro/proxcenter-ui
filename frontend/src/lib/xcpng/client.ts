/**
 * XCP-ng / Xen Orchestra REST API client
 *
 * XO exposes a REST API at /rest/v0/ with Basic auth.
 * Credentials are stored as "user:password" in apiTokenEnc (same as VMware).
 *
 * Key endpoints for migration:
 * - GET /rest/v0/vms/{uuid}           → VM config
 * - GET /rest/v0/vbds/{uuid}          → Virtual Block Device (links VM to VDI)
 * - GET /rest/v0/vdis/{uuid}          → Virtual Disk Image metadata
 * - GET /rest/v0/vdis/{uuid}.vhd      → Download VDI as VHD
 * - GET /rest/v0/vdis/{uuid}.raw      → Download VDI as raw image
 */

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"

export interface XoConnectionInfo {
  baseUrl: string
  authHeader: string
  insecureTLS: boolean
}

export interface XoVmConfig {
  uuid: string
  name: string
  powerState: string          // Running | Halted | Paused | Suspended
  numCPU: number
  memoryMB: number
  firmware: "bios" | "uefi"
  virtualizationMode: string  // hvm | pv
  guestOS: string
  tags: string[]
  snapshotCount: number
  disks: XoDiskInfo[]
  networks: XoNetworkInfo[]
}

export interface XoDiskInfo {
  vdiUuid: string
  label: string
  sizeBytes: number
  position: number            // device position (0, 1, ...)
  srUuid: string
}

export interface XoNetworkInfo {
  device: string
  mac: string
  network: string
}

/**
 * Get XO connection info from a stored connection
 */
export async function getXoConnectionInfo(connectionId: string): Promise<XoConnectionInfo> {
  const prisma = await getSessionPrisma()
  const conn = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
  })

  if (!conn || conn.type !== "xcpng") {
    throw new Error("XCP-ng connection not found")
  }

  const creds = decryptSecret(conn.apiTokenEnc)
  const authHeader = `Basic ${Buffer.from(creds).toString("base64")}`

  return {
    baseUrl: conn.baseUrl.replace(/\/$/, ""),
    authHeader,
    insecureTLS: conn.insecureTLS,
  }
}

/**
 * Fetch from XO REST API
 */
async function xoFetch<T = any>(xo: XoConnectionInfo, path: string): Promise<T> {
  const fetchOpts: any = {
    headers: {
      Authorization: xo.authHeader,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30000),
  }

  if (xo.insecureTLS) {
    fetchOpts.dispatcher = new (await import("undici")).Agent({
      connect: { rejectUnauthorized: false },
    })
  }

  const res = await fetch(`${xo.baseUrl}/rest/v0${path}`, fetchOpts)

  if (!res.ok) {
    throw new Error(`XO API error: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

/**
 * Get full VM configuration including disks and networks
 */
export async function xoGetVmConfig(xo: XoConnectionInfo, vmUuid: string): Promise<XoVmConfig> {
  const vm = await xoFetch<any>(xo, `/vms/${vmUuid}`)

  // Resolve VBDs to get disk info
  const vbdUuids: string[] = vm.$VBDs || []
  const disks: XoDiskInfo[] = []
  const networks: XoNetworkInfo[] = []

  // Fetch VBDs in parallel
  const vbds = await Promise.all(
    vbdUuids.map(uuid => xoFetch<any>(xo, `/vbds/${uuid}`).catch(() => null))
  )

  for (const vbd of vbds) {
    if (!vbd) continue

    // Skip CD-ROM drives
    if (vbd.is_cd_drive || vbd.type === "CD") continue

    // Get VDI details
    const vdiUuid = vbd.VDI
    if (!vdiUuid) continue

    try {
      const vdi = await xoFetch<any>(xo, `/vdis/${vdiUuid}`)
      disks.push({
        vdiUuid: vdi.uuid,
        label: vdi.name_label || `disk-${vbd.position}`,
        sizeBytes: vdi.size || 0,
        position: typeof vbd.position === "number" ? vbd.position : Number.parseInt(vbd.position, 10) || 0,
        srUuid: vdi.$SR || "",
      })
    } catch (e: any) {
      console.warn(`[xo] Failed to fetch VDI ${vdiUuid}: ${e?.message}`)
    }
  }

  // Sort disks by position
  disks.sort((a, b) => a.position - b.position)

  // Resolve VIFs for network info
  const vifUuids: string[] = vm.$VIFs || []
  const vifs = await Promise.all(
    vifUuids.map(uuid => xoFetch<any>(xo, `/vifs/${uuid}`).catch(() => null))
  )

  for (const vif of vifs) {
    if (!vif) continue
    networks.push({
      device: vif.device || "0",
      mac: vif.MAC || "",
      network: vif.$network || "",
    })
  }

  // Determine firmware
  const hvmBootFirmware = vm.boot?.firmware || ""
  const firmware = hvmBootFirmware === "uefi" ? "uefi" : "bios"

  return {
    uuid: vm.uuid,
    name: vm.name_label || vm.name || "Unknown",
    powerState: vm.power_state || "Halted",
    numCPU: vm.CPUs?.number || vm.CPUs?.max || 1,
    memoryMB: Math.round((vm.memory?.size || vm.memory?.dynamic?.[1] || 0) / 1048576),
    firmware,
    virtualizationMode: vm.virtualizationMode || "hvm",
    guestOS: vm.os_version?.name || vm.os_version?.distro || "",
    tags: vm.tags || [],
    snapshotCount: vm.snapshots?.length || vm.$snapshots?.length || 0,
    disks,
    networks,
  }
}

/**
 * Build the download URL for a VDI (raw format for direct import)
 */
export function buildVdiDownloadUrl(baseUrl: string, vdiUuid: string, format: "vhd" | "raw" = "raw"): string {
  return `${baseUrl.replace(/\/$/, "")}/rest/v0/vdis/${vdiUuid}.${format}`
}

/**
 * Build Basic auth header value from user:password credentials
 */
export function buildXoAuthHeader(creds: string): string {
  return `Basic ${Buffer.from(creds).toString("base64")}`
}

/**
 * POST to XO REST API (actions, snapshot creation, etc.)
 */
async function xoPost<T = any>(xo: XoConnectionInfo, path: string, body?: Record<string, any>): Promise<T> {
  const fetchOpts: any = {
    method: "POST",
    headers: {
      Authorization: xo.authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(120000),
  }

  if (body) fetchOpts.body = JSON.stringify(body)

  if (xo.insecureTLS) {
    fetchOpts.dispatcher = new (await import("undici")).Agent({
      connect: { rejectUnauthorized: false },
    })
  }

  const res = await fetch(`${xo.baseUrl}/rest/v0${path}`, fetchOpts)

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`XO API POST ${path} failed: ${res.status} ${res.statusText} ${text}`)
  }

  const contentType = res.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return res.json()
  }
  // Some XO actions return the UUID as plain text
  const text = await res.text()
  return text.trim() as unknown as T
}

/**
 * DELETE on XO REST API
 */
async function xoDelete(xo: XoConnectionInfo, path: string): Promise<void> {
  const fetchOpts: any = {
    method: "DELETE",
    headers: { Authorization: xo.authHeader },
    signal: AbortSignal.timeout(60000),
  }

  if (xo.insecureTLS) {
    fetchOpts.dispatcher = new (await import("undici")).Agent({
      connect: { rejectUnauthorized: false },
    })
  }

  const res = await fetch(`${xo.baseUrl}/rest/v0${path}`, fetchOpts)
  if (!res.ok && res.status !== 404) {
    throw new Error(`XO API DELETE ${path} failed: ${res.status} ${res.statusText}`)
  }
}

export interface XoSnapshotInfo {
  uuid: string
  name: string
  disks: XoDiskInfo[]
}

/**
 * Wait for an XO async task to complete. Returns the task result.
 * XO tasks have status: pending | success | failure
 */
async function xoWaitForTask(xo: XoConnectionInfo, taskId: string, timeoutMs = 300000): Promise<any> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const task = await xoFetch<any>(xo, `/tasks/${taskId}`)
    if (task.status === "success") {
      return task.result
    }
    if (task.status === "failure") {
      const errMsg = task.result?.message || task.result || "unknown error"
      throw new Error(`XO task ${taskId} failed: ${errMsg}`)
    }
    // Still pending — wait and poll again
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error(`XO task ${taskId} timed out after ${timeoutMs / 1000}s`)
}

/**
 * Create a snapshot of a VM via XO REST API.
 * The action is async — XO returns a taskId, we poll until the snapshot UUID is available.
 */
export async function xoCreateSnapshot(xo: XoConnectionInfo, vmUuid: string, name: string): Promise<string> {
  const result = await xoPost<any>(xo, `/vms/${vmUuid}/actions/snapshot`, { name })

  // XO may return the UUID directly (string) or a task reference
  if (typeof result === "string" && result.length > 30) return result // UUID format
  if (typeof result === "object" && result.$id) return result.$id
  if (typeof result === "object" && result.uuid) return result.uuid

  // Async task — poll for completion
  if (typeof result === "object" && result.taskId) {
    const snapshotUuid = await xoWaitForTask(xo, result.taskId)
    // Task result is the snapshot UUID (string) or an object with id/$id/uuid
    if (typeof snapshotUuid === "string" && snapshotUuid.length > 0) return snapshotUuid
    if (typeof snapshotUuid === "object" && snapshotUuid?.id) return snapshotUuid.id
    if (typeof snapshotUuid === "object" && snapshotUuid?.$id) return snapshotUuid.$id
    if (typeof snapshotUuid === "object" && snapshotUuid?.uuid) return snapshotUuid.uuid
    throw new Error(`XO snapshot task completed but no UUID in result: ${JSON.stringify(snapshotUuid)}`)
  }

  throw new Error(`Unexpected snapshot response: ${JSON.stringify(result)}`)
}

/**
 * Get the VDIs (disks) belonging to a snapshot.
 * Snapshots are accessed via /vm-snapshots/ (not /vms/).
 *
 * Note: snapshot VDIs are NOT accessible via /vdis/ (404), so we resolve
 * only the VDI UUID from the VBD and use the original VM disk metadata
 * (label, size) matched by position.
 */
export async function xoGetSnapshotDisks(
  xo: XoConnectionInfo,
  snapshotUuid: string,
  originalDisks: XoDiskInfo[]
): Promise<XoDiskInfo[]> {
  const snap = await xoFetch<any>(xo, `/vm-snapshots/${snapshotUuid}`)
  const vbdUuids: string[] = snap.$VBDs || []
  const disks: XoDiskInfo[] = []

  const vbds = await Promise.all(
    vbdUuids.map(uuid => xoFetch<any>(xo, `/vbds/${uuid}`).catch(() => null))
  )

  for (const vbd of vbds) {
    if (!vbd) continue
    if (vbd.is_cd_drive || vbd.type === "CD") continue
    const vdiUuid = vbd.VDI
    if (!vdiUuid) continue

    const position = typeof vbd.position === "number" ? vbd.position : Number.parseInt(vbd.position, 10) || 0

    // Match with original VM disk by position to get label/size metadata
    const originalDisk = originalDisks.find(d => d.position === position)

    disks.push({
      vdiUuid,  // Snapshot VDI UUID — use this for download
      label: originalDisk?.label || `disk-${position}`,
      sizeBytes: originalDisk?.sizeBytes || 0,
      position,
      srUuid: originalDisk?.srUuid || "",
    })
  }

  disks.sort((a, b) => a.position - b.position)
  return disks
}

/**
 * Delete a snapshot via XO REST API.
 * Snapshots use the /vm-snapshots/ endpoint.
 */
export async function xoDeleteSnapshot(xo: XoConnectionInfo, snapshotUuid: string): Promise<void> {
  await xoDelete(xo, `/vm-snapshots/${snapshotUuid}`)
}
