import type { SoapSession } from "./soap"
import { soapRequest, soapGetVmConfig, extractProp, parseDiskCbtFields } from "./soap"

const ENV = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`

export interface ChangedArea { offset: number; length: number }

// ---- pure parsers / checks (unit-tested) ----

/**
 * Parse one QueryChangedDiskAreas response. NOTE: the top-level `length` is the
 * length of the area (starting at `startOffset`) that this single call covered,
 * NOT the disk size. Large disks require multiple calls (see queryAllChangedAreas).
 */
export function parseChangedDiskAreas(xml: string): { startOffset: number; length: number; extents: ChangedArea[] } {
  const head = xml.match(/<startOffset>(\d+)<\/startOffset>\s*<length>(\d+)<\/length>/)
  const startOffset = head ? Number(head[1]) : 0
  const length = head ? Number(head[2]) : 0
  const extents: ChangedArea[] = []
  const re = /<changedArea>\s*<start>(\d+)<\/start>\s*<length>(\d+)<\/length>\s*<\/changedArea>/g
  let m
  while ((m = re.exec(xml)) !== null) extents.push({ offset: Number(m[1]), length: Number(m[2]) })
  return { startOffset, length, extents }
}

/**
 * Map each VirtualDisk's deviceKey to its backing changeId from a snapshot's
 * `config.hardware.device` XML. This is the per-disk baseline (cid_k) recorded
 * after each pass's snapshot, used as the `changeId` argument to the NEXT
 * QueryChangedDiskAreas. Reuses parseDiskCbtFields and the same VirtualDisk
 * delimiter parseVmConfig uses. Pure.
 */
export function parseSnapshotChangeIds(deviceXml: string): Map<number, string> {
  const map = new Map<number, string>()
  const diskRegex = /xsi:type="VirtualDisk">([\s\S]*?)(?=<VirtualDevice|$)/g
  let m: RegExpExecArray | null
  while ((m = diskRegex.exec(deviceXml)) !== null) {
    const { deviceKey, changeId } = parseDiskCbtFields(m[1])
    if (deviceKey) map.set(deviceKey, changeId)
  }
  return map
}

export interface CbtEligibilityInput { hwVersion: string; disks: { diskMode?: string; sharing?: string }[] }

/** Pure eligibility check: CBT needs hw version >= 7 and no independent / multi-writer disks. */
export function cbtEligibility(vm: CbtEligibilityInput): { eligible: boolean; reason?: string } {
  const ver = Number.parseInt(vm.hwVersion.replace("vmx-", ""), 10) || 0
  if (ver < 7) return { eligible: false, reason: `hardware version ${vm.hwVersion} is below vmx-07` }
  for (const d of vm.disks) {
    if ((d.diskMode || "").includes("independent")) return { eligible: false, reason: "independent disk present" }
    if (d.sharing === "sharingMultiWriter") return { eligible: false, reason: "multi-writer disk present" }
  }
  return { eligible: true }
}

// ---- SOAP callers ----

function faultOf(xml: string): string | null {
  return xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? null
}

/** Poll a result-less *_Task to success or error (polls first, then sleeps). */
async function waitVoidTask(session: SoapSession, taskMor: string, timeoutMs = 120000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const body = ENV(`<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>` +
      `<urn:specSet><urn:propSet><urn:type>Task</urn:type><urn:pathSet>info.state</urn:pathSet><urn:pathSet>info.error</urn:pathSet></urn:propSet>` +
      `<urn:objectSet><urn:obj type="Task">${taskMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet></urn:specSet><urn:options/></urn:RetrievePropertiesEx>`)
    const res = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
    if (/<val[^>]*>success<\/val>/.test(res.text)) return
    if (/<val[^>]*>error<\/val>/.test(res.text)) {
      throw new Error(res.text.match(/<localizedMessage>([^<]*)<\/localizedMessage>/)?.[1] || "Task failed")
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error("Task timed out")
}

async function reconfigCbt(session: SoapSession, vmid: string, enabled: boolean): Promise<void> {
  const res = await soapRequest(session.baseUrl, ENV(
    `<urn:ReconfigVM_Task><urn:_this type="VirtualMachine">${vmid}</urn:_this>` +
    `<urn:spec><urn:changeTrackingEnabled>${enabled}</urn:changeTrackingEnabled></urn:spec></urn:ReconfigVM_Task>`,
  ), session.cookie, session.insecureTLS)
  const fault = faultOf(res.text)
  if (fault) throw new Error(`ReconfigVM (CBT) failed: ${fault}`)
  const taskMor = res.text.match(/<returnval type="Task">([^<]+)<\/returnval>/)?.[1]
  if (!taskMor) throw new Error("ReconfigVM_Task returned no task")
  await waitVoidTask(session, taskMor)
}

export const soapEnableCbt = (s: SoapSession, vmid: string) => reconfigCbt(s, vmid, true)
export const soapDisableCbt = (s: SoapSession, vmid: string) => reconfigCbt(s, vmid, false)

/** One QueryChangedDiskAreas call: returns the covered window + its changed extents. */
export async function soapQueryChangedDiskAreas(
  session: SoapSession, vmid: string, snapshotMor: string, deviceKey: number, startOffset: number, changeId: string,
): Promise<{ startOffset: number; length: number; extents: ChangedArea[] }> {
  const res = await soapRequest(session.baseUrl, ENV(
    `<urn:QueryChangedDiskAreas><urn:_this type="VirtualMachine">${vmid}</urn:_this>` +
    `<urn:snapshot type="VirtualMachineSnapshot">${snapshotMor}</urn:snapshot>` +
    `<urn:deviceKey>${deviceKey}</urn:deviceKey><urn:startOffset>${startOffset}</urn:startOffset>` +
    `<urn:changeId>${changeId}</urn:changeId></urn:QueryChangedDiskAreas>`,
  ), session.cookie, session.insecureTLS)
  const fault = faultOf(res.text)
  if (fault) throw new Error(`QueryChangedDiskAreas failed: ${fault}`)
  return parseChangedDiskAreas(res.text)
}

/**
 * Page through QueryChangedDiskAreas until the whole disk capacity is covered,
 * accumulating all changed extents. vCenter caps the area covered per call on
 * large disks, so a single call is not enough for multi-GB/TB disks.
 */
export async function queryAllChangedAreas(
  session: SoapSession, vmid: string, snapshotMor: string, deviceKey: number, changeId: string, diskCapacityBytes: number,
): Promise<ChangedArea[]> {
  const all: ChangedArea[] = []
  let offset = 0
  for (let guard = 0; offset < diskCapacityBytes && guard < 100000; guard++) {
    const { startOffset, length, extents } = await soapQueryChangedDiskAreas(session, vmid, snapshotMor, deviceKey, offset, changeId)
    all.push(...extents)
    if (length <= 0) break // no progress reported; stop rather than loop forever
    offset = startOffset + length
  }
  return all
}

/**
 * Retrieve a snapshot's per-disk changeId map (deviceKey -> changeId) by reading
 * the snapshot object's `config.hardware.device`. Record this after creating
 * each pass's snapshot; it is the baseline for the next QueryChangedDiskAreas.
 */
export async function soapGetSnapshotChangeIds(session: SoapSession, snapshotMor: string): Promise<Map<number, string>> {
  const res = await soapRequest(session.baseUrl, ENV(
    `<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>` +
    `<urn:specSet><urn:propSet><urn:type>VirtualMachineSnapshot</urn:type><urn:pathSet>config.hardware.device</urn:pathSet></urn:propSet>` +
    `<urn:objectSet><urn:obj type="VirtualMachineSnapshot">${snapshotMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet></urn:specSet><urn:options/></urn:RetrievePropertiesEx>`,
  ), session.cookie, session.insecureTLS)
  const fault = faultOf(res.text)
  if (fault) throw new Error(`QuerySnapshotChangeIds failed: ${fault}`)
  return parseSnapshotChangeIds(extractProp(res.text, "config.hardware.device"))
}

/**
 * Send a no-op CurrentTime request to the ServiceInstance to reset the server's
 * SOAP-session idle timer. Issue #394: the warm pipeline holds the SOAP session
 * for the full duration of a long dd copy (potentially >30 min) with no SOAP
 * traffic, so vCenter/ESXi can reap the idle session. startSoapKeepAlive in
 * session-keepalive.ts calls this every 60 s. All errors are swallowed: a
 * transient keepalive failure must never abort a migration.
 */
export async function soapKeepAlive(session: SoapSession): Promise<void> {
  await soapRequest(session.baseUrl, ENV(
    `<urn:CurrentTime><urn:_this type="ServiceInstance">ServiceInstance</urn:_this></urn:CurrentTime>`,
  ), session.cookie, session.insecureTLS).catch(() => {})
}

/** Initiate a clean guest shutdown via VMware Tools. Returns immediately; the guest powers off asynchronously, so poll with soapWaitPoweredOff before relying on it. */
export async function soapGuestShutdown(session: SoapSession, vmid: string): Promise<void> {
  const res = await soapRequest(session.baseUrl, ENV(
    `<urn:ShutdownGuest><urn:_this type="VirtualMachine">${vmid}</urn:_this></urn:ShutdownGuest>`,
  ), session.cookie, session.insecureTLS)
  const fault = faultOf(res.text)
  if (fault) throw new Error(`ShutdownGuest failed: ${fault}`)
}

/** Poll runtime.powerState until poweredOff or timeout. Returns true if it reached poweredOff. */
export async function soapWaitPoweredOff(session: SoapSession, vmid: string, timeoutMs = 300000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const xml = await soapGetVmConfig(session, vmid)
    if (extractProp(xml, "runtime.powerState") === "poweredOff") return true
    await new Promise(r => setTimeout(r, 3000))
  }
  return false
}
