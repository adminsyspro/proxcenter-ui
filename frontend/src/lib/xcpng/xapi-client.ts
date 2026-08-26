/**
 * Minimal XAPI (XCP-ng / XenServer) client over JSON-RPC 2.0.
 *
 * Wire facts (measured on XCP-ng 8.3, xapi 25.6):
 *   POST https://<host>/jsonrpc  {"jsonrpc":"2.0","id":n,"method":"VM.get_by_uuid","params":[sessionRef, uuid]}
 *   success → {"jsonrpc":"2.0","result":<value>,"id":n}          (numbers are JSON numbers, e.g. virtual_size)
 *   failure → {"jsonrpc":"2.0","error":{"code":1,"message":"HANDLE_INVALID","data":["VM","OpaqueRef:nope"]},"id":n}
 *   A slave host answers HOST_IS_SLAVE with the master address as data[0].
 */
import { fetchWithInsecureTLS } from "@/lib/http/insecure-fetch"
import type { XoVmConfig, XoDiskInfo, XoNetworkInfo } from "@/lib/xcpng/client"
import type { Extent } from "@/lib/migration/warm/extents"
import { cbtBitmapToExtents } from "./cbt-bitmap"

export interface XapiSession { baseUrl: string; insecureTLS: boolean; ref: string }

export class XapiError extends Error {
  constructor(public readonly code: string, public readonly params: string[]) {
    super(params.length ? `${code} ${params.join(" ")}` : code)
    this.name = "XapiError"
  }
}

export const XAPI_CALL_TIMEOUT_MS = 60_000
export const XAPI_NULL_REF = "OpaqueRef:NULL"
let rpcId = 0

/** Accept "10.0.0.5", "xcp1.lan", "http://x" or "https://x/" and return "https://x". */
export function normalizeXapiBaseUrl(input: string): string {
  const t = (input || "").trim().replace(/\/+$/, "")
  if (!t) throw new Error("XCP-ng pool master address is required")
  if (/^https?:\/\//i.test(t)) return t.replace(/^http:\/\//i, "https://")
  return `https://${t}`
}

function xapiErrorFromBody(body: any): XapiError {
  const data = Array.isArray(body?.error?.data) ? body.error.data.map(String) : []
  return new XapiError(String(body?.error?.message || "XAPI_ERROR"), data)
}

async function rpc<T>(baseUrl: string, insecureTLS: boolean, method: string, params: unknown[]): Promise<T> {
  const res = await fetchWithInsecureTLS(`${baseUrl}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(XAPI_CALL_TIMEOUT_MS),
    insecureTLS,
  })
  if (!res.ok) {
    // xapi answers some faults (expired session, HOST_IS_SLAVE behind a proxy) with a
    // JSON-RPC error object and a non 2xx status: prefer the XAPI code over the HTTP one.
    let errBody: any = null
    try { errBody = await res.json() } catch { errBody = null }
    if (errBody?.error) throw xapiErrorFromBody(errBody)
    throw new Error(`XAPI HTTP ${res.status} ${res.statusText} on ${method}`)
  }
  const body: any = await res.json()
  if (body?.error) throw xapiErrorFromBody(body)
  return body?.result as T
}

export async function xapiLogin(baseUrl: string, user: string, password: string, insecureTLS: boolean): Promise<XapiSession> {
  let url = normalizeXapiBaseUrl(baseUrl)
  for (let attempt = 0; ; attempt++) {
    try {
      const ref = await rpc<string>(url, insecureTLS, "session.login_with_password", [user, password, "2.0", "proxcenter"])
      return { baseUrl: url, insecureTLS, ref }
    } catch (e) {
      if (attempt === 0 && e instanceof XapiError && e.code === "HOST_IS_SLAVE" && e.params[0]) { url = normalizeXapiBaseUrl(e.params[0]); continue }
      throw e
    }
  }
}

export async function xapiLogout(s: XapiSession): Promise<void> {
  await rpc(s.baseUrl, s.insecureTLS, "session.logout", [s.ref]).catch(() => {})
}

export function xapiCall<T = any>(s: XapiSession, method: string, ...params: unknown[]): Promise<T> {
  return rpc<T>(s.baseUrl, s.insecureTLS, method, [s.ref, ...params])
}

/** Cheap authenticated call used as a session keepalive. */
export async function xapiKeepAlive(s: XapiSession): Promise<void> {
  await xapiCall(s, "session.get_this_host", s.ref)
}

export interface XapiAsyncOpts { timeoutMs?: number; pollMs?: number; shouldAbort?: () => boolean }

const OPAQUE_REF_RE = /OpaqueRef:[0-9a-fA-F-]+/

/**
 * A task result comes back as an XML-RPC fragment, and the wrapping varies by xapi build:
 * `<value>OpaqueRef:x</value>` or `<value><string>OpaqueRef:x</string></value>`. Pull the
 * reference out when there is one, otherwise just strip the outer <value> tags.
 */
function unwrapTaskResult(raw: unknown): string {
  const text = String(raw ?? "")
  const ref = OPAQUE_REF_RE.exec(text)
  if (ref) return ref[0]
  return text.replace(/^<value>/, "").replace(/<\/value>$/, "")
}

/** Run `Async.<method>` and poll its task. Returns the task result with XML-RPC <value> wrapping removed. */
export async function xapiCallAsync(s: XapiSession, method: string, params: unknown[], opts: XapiAsyncOpts = {}): Promise<string> {
  const taskRef = await xapiCall<string>(s, `Async.${method}`, ...params)
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      if (opts.shouldAbort?.()) { await xapiCall(s, "task.cancel", taskRef).catch(() => {}); throw new Error(`XAPI task ${method} cancelled`) }
      const rec = await xapiCall<any>(s, "task.get_record", taskRef)
      if (rec.status === "success") return unwrapTaskResult(rec.result)
      if (rec.status === "failure") {
        const info: string[] = Array.isArray(rec.error_info) ? rec.error_info.map(String) : []
        throw new XapiError(info[0] || "TASK_FAILED", info.slice(1))
      }
      if (rec.status === "cancelled" || rec.status === "cancelling") throw new XapiError("TASK_CANCELLED", [method])
      await new Promise(r => setTimeout(r, opts.pollMs ?? 2000))
    }
    // Cancel before the finally block destroys the record, otherwise the snapshot or
    // shutdown keeps running on the pool with nobody watching it.
    await xapiCall(s, "task.cancel", taskRef).catch(() => {})
    throw new Error(`XAPI task ${method} timed out after ${Math.round(timeoutMs / 1000)}s`)
  } finally {
    await xapiCall(s, "task.destroy", taskRef).catch(() => {})
  }
}

// ── inventory ──

export interface XapiHostInfo { uuid: string; name_label: string; address: string; version: string }
export async function xapiHosts(s: XapiSession): Promise<XapiHostInfo[]> {
  const recs = await xapiCall<Record<string, any>>(s, "host.get_all_records")
  return Object.values(recs).map(h => ({ uuid: h.uuid, name_label: h.name_label, address: h.address, version: h.software_version?.product_version || "" }))
}

export interface XcpngVmListItem {
  uuid: string; name_label: string; power_state: string
  CPUs: { number: number; max: number }; memory: { size: number }; os_version: Record<string, string>
}

export async function xapiListVms(s: XapiSession): Promise<XcpngVmListItem[]> {
  const [vms, metrics] = await Promise.all([
    xapiCall<Record<string, any>>(s, "VM.get_all_records"),
    xapiCall<Record<string, any>>(s, "VM_guest_metrics.get_all_records"),
  ])
  const out: XcpngVmListItem[] = []
  for (const vm of Object.values(vms)) {
    if (vm.is_a_template || vm.is_a_snapshot || vm.is_control_domain) continue
    out.push({
      uuid: vm.uuid, name_label: vm.name_label, power_state: vm.power_state,
      CPUs: { number: Number(vm.VCPUs_at_startup) || 1, max: Number(vm.VCPUs_max) || 1 },
      memory: { size: Number(vm.memory_static_max) || 0 },
      os_version: metrics[vm.guest_metrics]?.os_version || {},
    })
  }
  return out.sort((a, b) => a.name_label.localeCompare(b.name_label))
}

export async function xapiVmRefByUuid(s: XapiSession, uuid: string): Promise<string> {
  return xapiCall<string>(s, "VM.get_by_uuid", uuid)
}

/** Raw VM record plus the resolved guest metrics, for the VM detail route. */
export async function xapiGetVmRecord(s: XapiSession, uuid: string): Promise<any> {
  const ref = await xapiVmRefByUuid(s, uuid)
  const rec = await xapiCall<any>(s, "VM.get_record", ref)
  let guest: any = null
  if (rec.guest_metrics && rec.guest_metrics !== XAPI_NULL_REF) guest = await xapiCall<any>(s, "VM_guest_metrics.get_record", rec.guest_metrics).catch(() => null)
  return { ...rec, _ref: ref, _guest: guest }
}

/** Same shape as xoGetVmConfig so xcpngConfigMapper and the pipelines need no change. */
export async function xapiGetVmConfig(s: XapiSession, vmUuid: string): Promise<XoVmConfig> {
  const vm = await xapiGetVmRecord(s, vmUuid)
  const disks: XoDiskInfo[] = []
  for (const vbdRef of vm.VBDs as string[]) {
    const vbd = await xapiCall<any>(s, "VBD.get_record", vbdRef)
    if (vbd.type !== "Disk" || vbd.empty || !vbd.VDI || vbd.VDI === XAPI_NULL_REF) continue
    const vdi = await xapiCall<any>(s, "VDI.get_record", vbd.VDI)
    const sr = await xapiCall<any>(s, "SR.get_record", vdi.SR).catch(() => null)
    disks.push({
      vdiUuid: vdi.uuid, vdiRef: vbd.VDI, srType: sr?.type || "",
      label: vdi.name_label || `disk-${vbd.userdevice}`,
      sizeBytes: Number(vdi.virtual_size) || 0,
      position: Number.parseInt(vbd.userdevice, 10) || 0,
      srUuid: sr?.uuid || "",
    })
  }
  disks.sort((a, b) => a.position - b.position)
  const networks: XoNetworkInfo[] = []
  for (const vifRef of vm.VIFs as string[]) {
    const vif = await xapiCall<any>(s, "VIF.get_record", vifRef).catch(() => null)
    if (!vif) continue
    const net = await xapiCall<any>(s, "network.get_record", vif.network).catch(() => null)
    networks.push({ device: vif.device || "0", mac: vif.MAC || "", network: net?.uuid || "" })
  }
  const firmware = vm.HVM_boot_params?.firmware === "uefi" ? "uefi" : "bios"
  return {
    uuid: vm.uuid, name: vm.name_label || "Unknown", powerState: vm.power_state || "Halted",
    numCPU: Number(vm.VCPUs_at_startup) || Number(vm.VCPUs_max) || 1,
    memoryMB: Math.round((Number(vm.memory_static_max) || 0) / 1048576),
    firmware, virtualizationMode: vm.HVM_boot_policy ? "hvm" : "pv",
    guestOS: vm._guest?.os_version?.name || vm._guest?.os_version?.distro || "",
    tags: vm.tags || [], snapshotCount: (vm.snapshots || []).length, disks, networks,
  }
}

/**
 * Offline download URL: the same XAPI endpoint Xen Orchestra streams from. No auth
 * header, the session is in the URL. Both OpaqueRefs are hex, dashes and one colon,
 * so they go in raw: that is the form the lab verified against xapi.
 */
export function xapiVdiExportUrl(s: XapiSession, vdiRef: string, format: "vhd" | "raw"): string {
  return `${s.baseUrl}/export_raw_vdi?session_id=${s.ref}&vdi=${vdiRef}&format=${format}`
}

// ── warm: CBT and NBD ──

/** SR types whose VDIs are VHD based and support changed block tracking. */
export const CBT_CAPABLE_SR_TYPES = new Set(["ext", "nfs", "lvm", "lvmoiscsi", "lvmohba", "lvmofcoe", "smb", "cifs", "xfs", "zfs"])

export async function xapiNbdEnabled(s: XapiSession): Promise<boolean> {
  const nets = await xapiCall<Record<string, any>>(s, "network.get_all_records")
  return Object.values(nets).some(n => Array.isArray(n.purpose) && (n.purpose.includes("nbd") || n.purpose.includes("insecure_nbd")))
}

export async function xapiManagementNetworkUuid(s: XapiSession): Promise<string> {
  const pifs = await xapiCall<Record<string, any>>(s, "PIF.get_all_records")
  const mgmt = Object.values(pifs).find(p => p.management)
  if (!mgmt) return "<network uuid>"
  return (await xapiCall<any>(s, "network.get_record", mgmt.network))?.uuid || "<network uuid>"
}

export async function xapiEnableCbt(s: XapiSession, vdiRef: string): Promise<void> {
  const enabled = await xapiCall<boolean>(s, "VDI.get_cbt_enabled", vdiRef)
  if (!enabled) await xapiCall(s, "VDI.enable_cbt", vdiRef)
}
export async function xapiDisableCbt(s: XapiSession, vdiRef: string): Promise<void> {
  await xapiCall(s, "VDI.disable_cbt", vdiRef)
}

export interface XapiSnapshotDisk { position: number; vdiRef: string; vdiUuid: string; snapshotOfRef: string; sizeBytes: number }
export interface XapiSnapshot { ref: string; uuid: string; nameLabel: string; disks: XapiSnapshotDisk[] }

export async function xapiSnapshotVm(s: XapiSession, vmRef: string, nameLabel: string, opts: XapiAsyncOpts = {}): Promise<XapiSnapshot> {
  const ref = await xapiCallAsync(s, "VM.snapshot", [vmRef, nameLabel], { timeoutMs: 10 * 60_000, ...opts })
  return xapiDescribeSnapshot(s, ref)
}

export async function xapiDescribeSnapshot(s: XapiSession, ref: string): Promise<XapiSnapshot> {
  const rec = await xapiCall<any>(s, "VM.get_record", ref)
  const disks: XapiSnapshotDisk[] = []
  for (const vbdRef of rec.VBDs as string[]) {
    const vbd = await xapiCall<any>(s, "VBD.get_record", vbdRef)
    if (vbd.type !== "Disk" || vbd.empty || !vbd.VDI || vbd.VDI === XAPI_NULL_REF) continue
    const vdi = await xapiCall<any>(s, "VDI.get_record", vbd.VDI)
    disks.push({ position: Number.parseInt(vbd.userdevice, 10) || 0, vdiRef: vbd.VDI, vdiUuid: vdi.uuid, snapshotOfRef: vdi.snapshot_of, sizeBytes: Number(vdi.virtual_size) || 0 })
  }
  disks.sort((a, b) => a.position - b.position)
  return { ref, uuid: rec.uuid, nameLabel: rec.name_label, disks }
}

export interface XapiNbdInfo { address: string; port: number; exportname: string; cert: string; subject: string }
export async function xapiGetNbdInfo(s: XapiSession, vdiRef: string): Promise<XapiNbdInfo> {
  const infos = await xapiCall<any[]>(s, "VDI.get_nbd_info", vdiRef)
  if (!infos?.length) throw new Error("XAPI returned no NBD export for this VDI: is NBD enabled on a pool network (purpose=nbd)?")
  const i = infos[0]
  return { address: i.address, port: Number(i.port) || 10809, exportname: i.exportname, cert: i.cert || "", subject: i.subject || "" }
}

export async function xapiListChangedBlocks(s: XapiSession, baseVdiRef: string, vdiRef: string, sizeBytes: number): Promise<Extent[]> {
  const b64 = await xapiCall<string>(s, "VDI.list_changed_blocks", baseVdiRef, vdiRef)
  return cbtBitmapToExtents(b64, sizeBytes)
}

/** Detach a VDI from the control domain (xapi-nbd leaves a dom0 VBD behind after an export). */
export async function xapiDetachFromControlDomain(s: XapiSession, vdiRef: string): Promise<void> {
  const vbds = await xapiCall<string[]>(s, "VDI.get_VBDs", vdiRef)
  for (const vbdRef of vbds) {
    const vmRef = await xapiCall<string>(s, "VBD.get_VM", vbdRef).catch(() => "")
    if (!vmRef) continue
    const isDom0 = await xapiCall<boolean>(s, "VM.get_is_control_domain", vmRef).catch(() => false)
    if (!isDom0) continue
    await xapiCall(s, "VBD.unplug", vbdRef).catch(() => {})
    await xapiCall(s, "VBD.destroy", vbdRef).catch(() => {})
  }
}

const VDI_DESTROY_RETRIES = 5
const VDI_DESTROY_RETRY_MS = 2000

/** Destroy a snapshot VM and its disks. Retries VDI_IN_USE after detaching the VDI from dom0. */
export async function xapiDestroySnapshot(s: XapiSession, snapshotRef: string): Promise<void> {
  let snap: XapiSnapshot
  try {
    snap = await xapiDescribeSnapshot(s, snapshotRef)
  } catch (e) {
    // Already gone: nothing left to clean up. Any other failure (auth, network, a broken
    // pool) must reach the caller instead of leaving snapshot disks behind in silence.
    if (e instanceof XapiError && e.code === "HANDLE_INVALID") return
    throw e
  }
  const failures: string[] = []
  for (const d of snap.disks) {
    for (let attempt = 1; ; attempt++) {
      try { await xapiCall(s, "VDI.destroy", d.vdiRef); break } catch (e) {
        if (e instanceof XapiError && e.code === "HANDLE_INVALID") break
        if (!(e instanceof XapiError && e.code === "VDI_IN_USE") || attempt >= VDI_DESTROY_RETRIES) {
          // Best effort: one stuck disk must not strand the others or the snapshot VM.
          failures.push(`${d.vdiUuid || d.vdiRef}: ${e instanceof Error ? e.message : String(e)}`)
          break
        }
        await xapiDetachFromControlDomain(s, d.vdiRef).catch(() => {})
        await new Promise(r => setTimeout(r, VDI_DESTROY_RETRY_MS))
      }
    }
  }
  await xapiCall(s, "VM.destroy", snapshotRef).catch((e: any) => { if (!(e instanceof XapiError && e.code === "HANDLE_INVALID")) throw e })
  if (failures.length) throw new Error(`snapshot ${snapshotRef} partially destroyed: ${failures.join("; ")}`)
}

export async function xapiFindSnapshotsByPrefix(s: XapiSession, vmRef: string, prefix: string): Promise<string[]> {
  const refs = await xapiCall<string[]>(s, "VM.get_snapshots", vmRef)
  const out: string[] = []
  for (const r of refs) {
    const label = await xapiCall<string>(s, "VM.get_name_label", r)
    if (label?.startsWith(prefix)) out.push(r)
  }
  return out
}

export type XapiPowerState = "Running" | "Halted" | "Suspended" | "Paused"
export async function xapiPowerState(s: XapiSession, vmRef: string): Promise<XapiPowerState> {
  return xapiCall<XapiPowerState>(s, "VM.get_power_state", vmRef)
}
/** How long a clean shutdown request is watched before the caller falls back to polling the power state. */
export const CLEAN_SHUTDOWN_WATCH_MS = 30_000
const CLEAN_SHUTDOWN_POLL_MS = 2000

/**
 * Ask the guest to shut down and watch the task for a short while only. A refusal
 * (VM_LACKS_FEATURE_SHUTDOWN, no guest agent) fails within seconds and is thrown
 * so the caller can log it. A guest that simply takes its time keeps shutting
 * down server side while the caller moves on to polling the power state, where
 * the operator has a force power off and a cancel; awaiting the task to
 * completion here (up to 10 min, as before) hid both. The pending task is left
 * alone: cancelling it would abort the shutdown, and it is not ours to destroy
 * while it runs (xapi reaps completed tasks itself).
 */
export async function xapiCleanShutdown(s: XapiSession, vmRef: string, opts: { shouldAbort?: () => boolean } = {}): Promise<void> {
  const taskRef = await xapiCall<string>(s, "Async.VM.clean_shutdown", vmRef)
  const deadline = Date.now() + CLEAN_SHUTDOWN_WATCH_MS
  while (Date.now() < deadline) {
    if (opts.shouldAbort?.()) return
    const rec = await xapiCall<any>(s, "task.get_record", taskRef)
    if (rec.status === "success") { await xapiCall(s, "task.destroy", taskRef).catch(() => {}); return }
    if (rec.status === "failure") {
      const info: string[] = Array.isArray(rec.error_info) ? rec.error_info.map(String) : []
      await xapiCall(s, "task.destroy", taskRef).catch(() => {})
      throw new XapiError(info[0] || "TASK_FAILED", info.slice(1))
    }
    if (rec.status === "cancelled" || rec.status === "cancelling") {
      await xapiCall(s, "task.destroy", taskRef).catch(() => {})
      throw new XapiError("TASK_CANCELLED", ["VM.clean_shutdown"])
    }
    await new Promise(r => setTimeout(r, CLEAN_SHUTDOWN_POLL_MS))
  }
}
export async function xapiHardShutdown(s: XapiSession, vmRef: string): Promise<void> {
  await xapiCallAsync(s, "VM.hard_shutdown", [vmRef], { timeoutMs: 5 * 60_000 })
}
