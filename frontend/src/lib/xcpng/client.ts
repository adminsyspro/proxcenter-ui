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

import { fetchWithInsecureTLS } from "@/lib/http/insecure-fetch"

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
  /** XAPI VDI reference, set when the config comes from a direct pool connection. */
  vdiRef?: string
  /** SR type (ext, nfs, lvm, ...), used for the CBT eligibility of a warm migration. */
  srType?: string
}

export interface XoNetworkInfo {
  device: string
  mac: string
  network: string
}

/**
 * Fetch from XO REST API
 */
export async function xoFetch<T = any>(xo: XoConnectionInfo, path: string): Promise<T> {
  const res = await fetchWithInsecureTLS(`${xo.baseUrl}/rest/v0${path}`, {
    headers: {
      Authorization: xo.authHeader,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30000),
    insecureTLS: xo.insecureTLS,
  })

  if (!res.ok) {
    throw new Error(`XO API error: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

/**
 * Hosts known to XO (connectivity and auth probe). A non array answer counts as no host.
 */
export async function xoListHosts(xo: XoConnectionInfo): Promise<{ name_label: string; address: string; version: string }[]> {
  const hosts = await xoFetch<any>(xo, "/hosts?fields=name_label,address,version")
  return (Array.isArray(hosts) ? hosts : []).map(h => ({ name_label: h?.name_label, address: h?.address, version: h?.version || "" }))
}

/**
 * Raw VM objects from XO. The `filter=type:VM` form is tried first; older XO
 * builds reject it, so the unfiltered query is the fallback.
 */
export async function xoListVms(xo: XoConnectionInfo): Promise<any[]> {
  let raw: any
  try {
    raw = await xoFetch<any>(xo, "/vms?fields=uuid,name_label,power_state,CPUs,memory,os_version&filter=type:VM")
  } catch {
    raw = await xoFetch<any>(xo, "/vms?fields=uuid,name_label,power_state,CPUs,memory,os_version")
  }
  return Array.isArray(raw) ? raw : []
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

  // Resolve VIFs for network info. XO 5.x answers `VIFs` on /vms/{uuid}; the
  // `$VIFs` spelling is kept as a fallback for older XO builds.
  const vifUuids: string[] = vm.VIFs || vm.$VIFs || []
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
