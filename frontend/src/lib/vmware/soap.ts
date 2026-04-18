/**
 * Shared VMware ESXi SOAP helpers
 * Used by both the VMware API routes and the migration pipeline
 */

import { retrieveAllPropertiesEx } from "./pagination"

export interface SoapSession {
  baseUrl: string
  cookie: string
  insecureTLS: boolean
  // Dynamic MORs from ServiceContent (discovered via RetrieveServiceContent)
  sessionManager: string    // "ha-sessionmgr" on ESXi, "SessionManager" on vCenter
  propertyCollector: string  // "ha-property-collector" on ESXi, "propertyCollector" on vCenter
  rootFolder: string         // "ha-folder-root" on ESXi, "group-d1" on vCenter
  isVcenter: boolean         // true if connected to vCenter
  datacenterPath?: string    // datacenter name for vCenter (used in dcPath for file downloads)
}

/** Discover service MORs via RetrieveServiceContent (works on both ESXi and vCenter) */
export async function soapRetrieveServiceContent(
  baseUrl: string,
  insecureTLS: boolean
): Promise<{
  sessionManager: string
  propertyCollector: string
  rootFolder: string
  isVcenter: boolean
  apiVersion: string
}> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveServiceContent>
      <urn:_this type="ServiceInstance">ServiceInstance</urn:_this>
    </urn:RetrieveServiceContent>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(baseUrl, body, "", insecureTLS)
  if (result.text.includes("faultstring") && !result.text.includes("returnval")) {
    const fault = result.text.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1] || "Unknown error"
    throw new Error(`RetrieveServiceContent failed: ${fault}`)
  }

  const sessionManager = result.text.match(/<sessionManager[^>]*>([^<]+)<\/sessionManager>/)?.[1] || "ha-sessionmgr"
  const propertyCollector = result.text.match(/<propertyCollector[^>]*>([^<]+)<\/propertyCollector>/)?.[1] || "ha-property-collector"
  const rootFolder = result.text.match(/<rootFolder[^>]*>([^<]+)<\/rootFolder>/)?.[1] || "ha-folder-root"
  const apiType = result.text.match(/<apiType>([^<]+)<\/apiType>/)?.[1] || "HostAgent"
  const apiVersion = result.text.match(/<version>([^<]+)<\/version>/)?.[1] || ""
  const isVcenter = apiType === "VirtualCenter"

  return { sessionManager, propertyCollector, rootFolder, isVcenter, apiVersion }
}

/** Send a SOAP request to the ESXi /sdk endpoint */
export async function soapRequest(
  baseUrl: string,
  body: string,
  cookie: string,
  insecureTLS: boolean,
  timeoutMs = 30000
): Promise<{ text: string; cookie?: string }> {
  const opts: any = {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"urn:vim25/8.0"',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  }
  if (insecureTLS) {
    opts.dispatcher = new (await import("undici")).Agent({ connect: { rejectUnauthorized: false } })
  }
  const res = await fetch(`${baseUrl}/sdk`, opts)
  const text = await res.text()
  if (!res.ok && !text.includes("returnval")) {
    const fault = text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1]
    throw new Error(`SOAP error ${res.status}: ${fault || text.substring(0, 500)}`)
  }
  const rawCookie = res.headers.get("set-cookie") || ""
  return { text, cookie: rawCookie.split(";")[0] || "" }
}

/** Login via SOAP and return a SoapSession */
export async function soapLogin(
  baseUrl: string,
  username: string,
  password: string,
  insecureTLS: boolean
): Promise<SoapSession> {
  // Step 1: Discover MORs via RetrieveServiceContent (no auth needed)
  const serviceContent = await soapRetrieveServiceContent(baseUrl, insecureTLS)

  // Step 2: Login using the discovered SessionManager MOR
  const escUser = username.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const escPass = password.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  const loginBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:Login>
      <urn:_this type="SessionManager">${serviceContent.sessionManager}</urn:_this>
      <urn:userName>${escUser}</urn:userName>
      <urn:password>${escPass}</urn:password>
    </urn:Login>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(baseUrl, loginBody, "", insecureTLS)
  if (result.text.includes("InvalidLogin") || (result.text.includes("faultstring") && !result.text.includes("returnval"))) {
    const fault = result.text.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1] || "Authentication failed"
    throw new Error(`VMware login failed: ${fault}`)
  }
  return {
    baseUrl,
    cookie: result.cookie || "",
    insecureTLS,
    sessionManager: serviceContent.sessionManager,
    propertyCollector: serviceContent.propertyCollector,
    rootFolder: serviceContent.rootFolder,
    isVcenter: serviceContent.isVcenter,
  }
}

/** Logout the SOAP session */
export async function soapLogout(session: SoapSession): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body><urn:Logout><urn:_this type="SessionManager">${session.sessionManager}</urn:_this></urn:Logout></soapenv:Body>
</soapenv:Envelope>`
  await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS).catch(() => {})
}

/** Extract a property value from SOAP XML */
export function extractProp(xml: string, propName: string): string {
  const regex = new RegExp(
    `<propSet>\\s*<name>${propName.replaceAll(".", "\\.")}</name>\\s*<val[^>]*>([\\s\\S]*?)</val>\\s*</propSet>`
  )
  return regex.exec(xml)?.[1] || ""
}

/** Get full VM config via SOAP PropertyCollector */
export async function soapGetVmConfig(session: SoapSession, vmid: string): Promise<string> {
  const retrieveBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>name</urn:pathSet>
          <urn:pathSet>config.guestFullName</urn:pathSet>
          <urn:pathSet>config.guestId</urn:pathSet>
          <urn:pathSet>config.hardware.numCPU</urn:pathSet>
          <urn:pathSet>config.hardware.numCoresPerSocket</urn:pathSet>
          <urn:pathSet>config.hardware.memoryMB</urn:pathSet>
          <urn:pathSet>config.version</urn:pathSet>
          <urn:pathSet>config.uuid</urn:pathSet>
          <urn:pathSet>config.firmware</urn:pathSet>
          <urn:pathSet>config.hardware.device</urn:pathSet>
          <urn:pathSet>runtime.powerState</urn:pathSet>
          <urn:pathSet>storage.perDatastoreUsage</urn:pathSet>
          <urn:pathSet>snapshot</urn:pathSet>
          <urn:pathSet>guest.toolsStatus</urn:pathSet>
          <urn:pathSet>guest.toolsRunningStatus</urn:pathSet>
          <urn:pathSet>guest.toolsVersionStatus2</urn:pathSet>
          <urn:pathSet>summary.guest.toolsStatus</urn:pathSet>
          <urn:pathSet>summary.guest.toolsRunningStatus</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">${vmid}</urn:obj>
          <urn:skip>false</urn:skip>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, retrieveBody, session.cookie, session.insecureTLS)
  if (result.text.includes("ManagedObjectNotFound")) {
    throw new Error("VM not found on ESXi host")
  }
  return result.text
}

/** Power off a VM via SOAP */
export async function soapPowerOffVm(session: SoapSession, vmid: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:PowerOffVM_Task>
      <urn:_this type="VirtualMachine">${vmid}</urn:_this>
    </urn:PowerOffVM_Task>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (result.text.includes("faultstring") && !result.text.includes("InvalidPowerState")) {
    const fault = result.text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] || result.text.substring(0, 500)
    throw new Error(`Failed to power off VM: ${fault}`)
  }

  // Wait for power off (poll power state)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const xml = await soapGetVmConfig(session, vmid)
    if (extractProp(xml, "runtime.powerState") === "poweredOff") return
  }
  throw new Error("VM did not power off within 60s")
}

/** Create a snapshot on a VM (makes base disks read-only and downloadable while VM runs) */
export async function soapCreateSnapshot(session: SoapSession, vmid: string, name: string, description = "", quiesce = false): Promise<string> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:CreateSnapshot_Task>
      <urn:_this type="VirtualMachine">${vmid}</urn:_this>
      <urn:name>${name}</urn:name>
      <urn:description>${description}</urn:description>
      <urn:memory>false</urn:memory>
      <urn:quiesce>${quiesce}</urn:quiesce>
    </urn:CreateSnapshot_Task>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (result.text.includes("faultstring")) {
    const fault = result.text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] || result.text.substring(0, 500)
    throw new Error(`Failed to create snapshot: ${fault}`)
  }

  // Extract task MOR and wait for completion
  const taskMor = result.text.match(/<returnval type="Task">([^<]+)<\/returnval>/)?.[1]
  if (!taskMor) throw new Error("No task returned from CreateSnapshot_Task")

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const statusBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet><urn:type>Task</urn:type><urn:pathSet>info.state</urn:pathSet><urn:pathSet>info.error</urn:pathSet><urn:pathSet>info.result</urn:pathSet></urn:propSet>
        <urn:objectSet><urn:obj type="Task">${taskMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`
    const status = await soapRequest(session.baseUrl, statusBody, session.cookie, session.insecureTLS)
    if (status.text.includes("success")) {
      // Extract snapshot MOR from result
      const snapMor = status.text.match(/<val[^>]*type="VirtualMachineSnapshot"[^>]*>([^<]+)<\/val>/)?.[1] || ""
      return snapMor
    }
    if (status.text.includes("error")) {
      const fault = status.text.match(/<localizedMessage>([^<]*)<\/localizedMessage>/)?.[1] || "Unknown error"
      throw new Error(`Snapshot creation failed: ${fault}`)
    }
  }
  throw new Error("Snapshot creation timed out after 120s")
}

/** Remove all snapshots from a VM */
export async function soapRemoveAllSnapshots(session: SoapSession, vmid: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RemoveAllSnapshots_Task>
      <urn:_this type="VirtualMachine">${vmid}</urn:_this>
      <urn:consolidate>true</urn:consolidate>
    </urn:RemoveAllSnapshots_Task>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (result.text.includes("faultstring")) {
    const fault = result.text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] || ""
    throw new Error(`Failed to remove snapshots: ${fault}`)
  }

  // Wait for task completion
  const taskMor = result.text.match(/<returnval type="Task">([^<]+)<\/returnval>/)?.[1]
  if (!taskMor) return

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const statusBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet><urn:type>Task</urn:type><urn:pathSet>info.state</urn:pathSet></urn:propSet>
        <urn:objectSet><urn:obj type="Task">${taskMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`
    const status = await soapRequest(session.baseUrl, statusBody, session.cookie, session.insecureTLS)
    if (status.text.includes("success") || status.text.includes("error")) return
  }
}

/**
 * Query whether a snapshot was actually quiesced (= VSS ran successfully in
 * the guest). When soapCreateSnapshot is called with quiesce=true, vCenter
 * silently falls back to a crash-consistent snapshot if VSS can't run (no
 * VMware Tools, broken VSS writers, etc.) and the call still succeeds. The
 * only way to know is to read the `quiesced` property on the resulting
 * snapshot MOR afterwards. Returns true if the snapshot is flagged quiesced,
 * false otherwise (including on query error — defensive).
 */
export async function soapGetSnapshotQuiesced(session: SoapSession, snapshotMor: string): Promise<boolean> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet><urn:type>VirtualMachineSnapshot</urn:type><urn:pathSet>config.quiesced</urn:pathSet></urn:propSet>
        <urn:objectSet><urn:obj type="VirtualMachineSnapshot">${snapshotMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`
  try {
    const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
    return /<val[^>]*>true<\/val>/i.test(result.text)
  } catch {
    return false
  }
}

/**
 * Remove a SPECIFIC snapshot by its MOR (not RemoveAllSnapshots). Used by the
 * live migration path so we don't destroy pre-existing snapshots the user had
 * on the source VM, only the one ProxCenter created for the NFC export.
 * removeChildren=true consolidates any child snapshots into the parent.
 */
export async function soapRemoveSnapshot(session: SoapSession, snapshotMor: string, removeChildren = true): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RemoveSnapshot_Task>
      <urn:_this type="VirtualMachineSnapshot">${snapshotMor}</urn:_this>
      <urn:removeChildren>${removeChildren}</urn:removeChildren>
      <urn:consolidate>true</urn:consolidate>
    </urn:RemoveSnapshot_Task>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (result.text.includes("faultstring")) {
    const fault = result.text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] || ""
    throw new Error(`Failed to remove snapshot ${snapshotMor}: ${fault}`)
  }

  // Wait for task completion (up to 2 min: merging a large delta can be slow)
  const taskMor = result.text.match(/<returnval type="Task">([^<]+)<\/returnval>/)?.[1]
  if (!taskMor) return

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const statusBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet><urn:type>Task</urn:type><urn:pathSet>info.state</urn:pathSet></urn:propSet>
        <urn:objectSet><urn:obj type="Task">${taskMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`
    const status = await soapRequest(session.baseUrl, statusBody, session.cookie, session.insecureTLS)
    if (status.text.includes("success") || status.text.includes("error")) return
  }
}

// ── HttpNfcLease (Export VM) — for downloading disks when snapshots are active ──

export interface NfcLeaseDeviceUrl {
  key: string
  url: string
  fileSize: number
  disk: boolean
  targetId: string
}

/** Initiate a VM export via HttpNfcLease — returns the lease MOR */
export async function soapExportVm(session: SoapSession, vmid: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:ExportVm>
      <urn:_this type="VirtualMachine">${vmid}</urn:_this>
    </urn:ExportVm>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (result.text.includes("faultstring")) {
    const fault = result.text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] || result.text.substring(0, 500)
    throw new Error(`ExportVm failed: ${fault}`)
  }
  const leaseMor = result.text.match(/<returnval type="HttpNfcLease">([^<]+)<\/returnval>/)?.[1]
  if (!leaseMor) throw new Error("ExportVm did not return an NFC lease")
  return leaseMor
}

/**
 * Initiate a snapshot export via HttpNfcLease. VirtualMachine.ExportVm() only
 * works on powered-off VMs (InvalidPowerState on running VMs), so live
 * migration paths must target the snapshot directly. The snapshot's VMDKs are
 * immutable, so vCenter is fine serving them even while the parent VM writes
 * to its delta. Returns the lease MOR (same shape as soapExportVm).
 */
export async function soapExportSnapshot(session: SoapSession, snapshotMor: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:ExportSnapshot>
      <urn:_this type="VirtualMachineSnapshot">${snapshotMor}</urn:_this>
    </urn:ExportSnapshot>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (result.text.includes("faultstring")) {
    const fault = result.text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] || result.text.substring(0, 500)
    throw new Error(`ExportSnapshot failed: ${fault}`)
  }
  const leaseMor = result.text.match(/<returnval type="HttpNfcLease">([^<]+)<\/returnval>/)?.[1]
  if (!leaseMor) throw new Error("ExportSnapshot did not return an NFC lease")
  return leaseMor
}

/** Wait for an NFC lease to become ready and return device download URLs */
export async function soapWaitForNfcLease(session: SoapSession, leaseMor: string): Promise<NfcLeaseDeviceUrl[]> {
  const host = session.baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>HttpNfcLease</urn:type>
          <urn:pathSet>state</urn:pathSet>
          <urn:pathSet>info</urn:pathSet>
          <urn:pathSet>error</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="HttpNfcLease">${leaseMor}</urn:obj>
          <urn:skip>false</urn:skip>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`

    const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
    const stateMatch = result.text.match(/<name>state<\/name>\s*<val[^>]*>([^<]+)<\/val>/)
    const state = stateMatch?.[1] || ""

    if (state === "error") {
      const errorMsg = result.text.match(/<localizedMessage>([^<]*)<\/localizedMessage>/)?.[1] || "Unknown lease error"
      throw new Error(`NFC lease error: ${errorMsg}`)
    }

    if (state === "ready") {
      // Parse deviceUrl entries from info
      const devices: NfcLeaseDeviceUrl[] = []
      const infoXml = result.text
      const deviceRegex = /<deviceUrl>([\s\S]*?)<\/deviceUrl>/g
      let match
      while ((match = deviceRegex.exec(infoXml)) !== null) {
        const d = match[1]
        const url = d.match(/<url>([^<]*)<\/url>/)?.[1] || ""
        const key = d.match(/<key>([^<]*)<\/key>/)?.[1] || ""
        const fileSize = Number.parseInt(d.match(/<fileSize>([^<]*)<\/fileSize>/)?.[1] || "0", 10)
        const disk = d.includes("<disk>true</disk>")
        const targetId = d.match(/<targetId>([^<]*)<\/targetId>/)?.[1] || ""

        if (url) {
          // ESXi returns URLs with * as hostname — replace with actual host
          devices.push({
            key,
            url: url.replace(/https:\/\/\*\//, `https://${host}/`),
            fileSize,
            disk,
            targetId,
          })
        }
      }
      return devices
    }
    // state === "initializing" — keep polling
  }
  throw new Error("NFC lease did not become ready within 60s")
}

/** Send progress keepalive to prevent NFC lease timeout (default lease timeout is 5 min) */
export async function soapNfcLeaseProgress(session: SoapSession, leaseMor: string, percent: number): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:HttpNfcLeaseProgress>
      <urn:_this type="HttpNfcLease">${leaseMor}</urn:_this>
      <urn:percent>${Math.min(99, Math.max(0, Math.round(percent)))}</urn:percent>
    </urn:HttpNfcLeaseProgress>
  </soapenv:Body>
</soapenv:Envelope>`
  await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS).catch(() => {})
}

/** Complete an NFC lease (signals successful download) */
export async function soapNfcLeaseComplete(session: SoapSession, leaseMor: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:HttpNfcLeaseComplete>
      <urn:_this type="HttpNfcLease">${leaseMor}</urn:_this>
    </urn:HttpNfcLeaseComplete>
  </soapenv:Body>
</soapenv:Envelope>`
  await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS).catch(() => {})
}

/** Abort an NFC lease (on error/cancellation) */
export async function soapNfcLeaseAbort(session: SoapSession, leaseMor: string, reason = "Migration aborted"): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:HttpNfcLeaseAbort>
      <urn:_this type="HttpNfcLease">${leaseMor}</urn:_this>
      <urn:fault>
        <faultMessage>${reason}</faultMessage>
      </urn:fault>
    </urn:HttpNfcLeaseAbort>
  </soapenv:Body>
</soapenv:Envelope>`
  await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS).catch(() => {})
}

export interface EsxiDiskInfo {
  label: string
  fileName: string // e.g. "[datastore1] vmname/vmname.vmdk"
  capacityBytes: number
  thinProvisioned: boolean
  datastoreName: string
  relativePath: string
  controllerType?: string // "scsi" | "sata" | "ide" — derived from controllerKey
}

export interface EsxiNicInfo {
  label: string
  type: string // Vmxnet3, E1000, etc.
  macAddress: string
  network: string
}

export interface EsxiVmConfig {
  name: string
  guestOS: string
  guestId: string
  numCPU: number
  numCoresPerSocket: number
  sockets: number
  memoryMB: number
  firmware: string // "bios" | "efi"
  uuid: string
  vmxVersion: string
  powerState: string
  committed: number
  disks: EsxiDiskInfo[]
  nics: EsxiNicInfo[]
  snapshotCount: number
  /**
   * VMware Tools status as reported by vCenter. Used to preflight live
   * migrations of Windows guests: without running Tools, VSS can't quiesce
   * the snapshot and virt-v2v will fail on a dirty NTFS.
   * Possible values: "toolsOk", "toolsOld", "toolsNotRunning", "toolsNotInstalled".
   */
  toolsStatus?: string
  /** "guestToolsRunning" | "guestToolsNotRunning" | "guestToolsExecutingScripts". */
  toolsRunningStatus?: string
}

/** Parse full VM config from SOAP XML */
export function parseVmConfig(xml: string): EsxiVmConfig {
  const name = extractProp(xml, "name")
  const guestOS = extractProp(xml, "config.guestFullName")
  const guestId = extractProp(xml, "config.guestId")
  const numCPU = Number.parseInt(extractProp(xml, "config.hardware.numCPU"), 10) || 1
  const numCoresPerSocket = Number.parseInt(extractProp(xml, "config.hardware.numCoresPerSocket"), 10) || 1
  const memoryMB = Number.parseInt(extractProp(xml, "config.hardware.memoryMB"), 10) || 512
  const firmware = extractProp(xml, "config.firmware") || "bios"
  const uuid = extractProp(xml, "config.uuid")
  const vmxVersion = extractProp(xml, "config.version")
  const powerState = extractProp(xml, "runtime.powerState")

  // Storage
  const storageXml = extractProp(xml, "storage.perDatastoreUsage")
  const committedMatch = storageXml.match(/<committed>(\d+)<\/committed>/)
  const committed = committedMatch ? Number.parseInt(committedMatch[1], 10) : 0

  // Disks
  const devicesXml = extractProp(xml, "config.hardware.device")

  // Build controllerKey -> type map from controller devices in the XML
  // ESXi controller keys: 1000-1003 = SCSI, 15000-15003 = SATA, 200-201 = IDE
  const controllerKeyMap = new Map<number, string>()
  const scsiCtrlRegex = /xsi:type="Virtual(?:LSILogic|BusLogic|ParaVirtual|LSILogicSAS)(?:Controller)?">([\s\S]*?)(?=<VirtualDevice|$)/g
  let ctrlMatch
  while ((ctrlMatch = scsiCtrlRegex.exec(devicesXml)) !== null) {
    const key = Number.parseInt(ctrlMatch[1].match(/<key>(\d+)<\/key>/)?.[1] || "0", 10)
    if (key) controllerKeyMap.set(key, "scsi")
  }
  const sataCtrlRegex = /xsi:type="VirtualAHCIController">([\s\S]*?)(?=<VirtualDevice|$)/g
  while ((ctrlMatch = sataCtrlRegex.exec(devicesXml)) !== null) {
    const key = Number.parseInt(ctrlMatch[1].match(/<key>(\d+)<\/key>/)?.[1] || "0", 10)
    if (key) controllerKeyMap.set(key, "sata")
  }
  const ideCtrlRegex = /xsi:type="VirtualIDEController">([\s\S]*?)(?=<VirtualDevice|$)/g
  while ((ctrlMatch = ideCtrlRegex.exec(devicesXml)) !== null) {
    const key = Number.parseInt(ctrlMatch[1].match(/<key>(\d+)<\/key>/)?.[1] || "0", 10)
    if (key) controllerKeyMap.set(key, "ide")
  }

  const disks: EsxiDiskInfo[] = []
  const diskRegex = /xsi:type="VirtualDisk">([\s\S]*?)(?=<VirtualDevice|$)/g
  let diskMatch
  while ((diskMatch = diskRegex.exec(devicesXml)) !== null) {
    const d = diskMatch[1]
    const label = d.match(/<label>([^<]*)<\/label>/)?.[1] || ""
    const capacityBytes = Number.parseInt(d.match(/<capacityInBytes>(\d+)<\/capacityInBytes>/)?.[1] || "0", 10) ||
      (Number.parseInt(d.match(/<capacityInKB>(\d+)<\/capacityInKB>/)?.[1] || "0", 10) * 1024)
    const fileName = d.match(/<fileName>([^<]*)<\/fileName>/)?.[1] || ""
    const thinProvisioned = d.includes("<thinProvisioned>true</thinProvisioned>")

    // Parse "[datastoreName] relative/path.vmdk"
    const dsMatch = fileName.match(/^\[([^\]]+)\]\s+(.+)$/)
    const datastoreName = dsMatch?.[1] || ""
    const relativePath = dsMatch?.[2] || ""

    // Resolve controller type from controllerKey
    const controllerKey = Number.parseInt(d.match(/<controllerKey>(\d+)<\/controllerKey>/)?.[1] || "0", 10)
    const controllerType = controllerKeyMap.get(controllerKey) || (controllerKey >= 1000 && controllerKey < 2000 ? "scsi" : controllerKey >= 15000 ? "sata" : controllerKey >= 200 && controllerKey < 300 ? "ide" : undefined)

    disks.push({ label, fileName, capacityBytes, thinProvisioned, datastoreName, relativePath, controllerType })
  }

  // NICs
  const nics: EsxiNicInfo[] = []
  const nicTypes = ["Vmxnet3", "E1000e", "E1000", "Vmxnet2", "Vmxnet"]
  for (const nicType of nicTypes) {
    const nicRegex = new RegExp(`xsi:type="Virtual${nicType}">([\\s\\S]*?)(?=<VirtualDevice|$)`, "g")
    let nicMatch
    while ((nicMatch = nicRegex.exec(devicesXml)) !== null) {
      const n = nicMatch[1]
      nics.push({
        label: n.match(/<label>([^<]*)<\/label>/)?.[1] || "",
        type: nicType,
        macAddress: n.match(/<macAddress>([^<]*)<\/macAddress>/)?.[1] || "",
        network: n.match(/<summary>([^<]*)<\/summary>/)?.[1] || "",
      })
    }
  }

  // Snapshots
  const snapshotXml = extractProp(xml, "snapshot")
  const snapshotCount = (snapshotXml.match(/<snapshot type="VirtualMachineSnapshot"/g) || []).length

  const sockets = numCPU > 0 && numCoresPerSocket > 0 ? Math.ceil(numCPU / numCoresPerSocket) : 1

  // VMware Tools status. Empty string when vCenter hasn't populated the
  // property (e.g. VM freshly created or tools never installed). Some vCenter
  // versions populate the shortcut summary.guest.* path instead of the
  // direct guest.* property, so fall back to the summary variant.
  const toolsStatus =
    extractProp(xml, "guest.toolsStatus") ||
    extractProp(xml, "summary.guest.toolsStatus") ||
    undefined
  const toolsRunningStatus =
    extractProp(xml, "guest.toolsRunningStatus") ||
    extractProp(xml, "summary.guest.toolsRunningStatus") ||
    undefined

  return {
    name, guestOS, guestId, numCPU, numCoresPerSocket, sockets, memoryMB,
    firmware, uuid, vmxVersion, powerState, committed, disks, nics, snapshotCount,
    toolsStatus, toolsRunningStatus,
  }
}

/**
 * Build HTTPS URLs to download a VMDK from ESXi/vCenter datastore browser.
 * ESXi exposes files at: https://host/folder/<path>?dcPath=ha-datacenter&dsName=<datastore>
 * vCenter uses the actual datacenter name for dcPath.
 *
 * The dcPath parameter defaults to "ha-datacenter" (ESXi) but can be overridden
 * via session.datacenterPath for vCenter connections.
 *
 * Returns the -flat.vmdk URL (raw disk data, standard for split VMDK).
 */
export function buildVmdkDownloadUrl(esxiBaseUrl: string, disk: EsxiDiskInfo, dcPath = "ha-datacenter"): string {
  const host = esxiBaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  const flatPath = disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
  return `https://${host}/folder/${encodeURIComponent(flatPath).replace(/%2F/g, "/")}?dcPath=${encodeURIComponent(dcPath)}&dsName=${encodeURIComponent(disk.datastoreName)}`
}

export function buildVmdkDescriptorUrl(esxiBaseUrl: string, disk: EsxiDiskInfo, dcPath = "ha-datacenter"): string {
  const host = esxiBaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return `https://${host}/folder/${encodeURIComponent(disk.relativePath).replace(/%2F/g, "/")}?dcPath=${encodeURIComponent(dcPath)}&dsName=${encodeURIComponent(disk.datastoreName)}`
}

// -- VM listing via SOAP (works on both ESXi and vCenter) --

export interface VmwareVmSummary {
  moId: string
  name: string
  powerState: string
  guestId: string
  guestOS: string
  cpu: number
  memoryMB: number
  committedStorage: number
  uncommittedStorage: number
  template: boolean
  /**
   * vCenter only: ManagedObjectReference of the HostSystem currently running this VM.
   * Empty string on standalone ESXi (no inventory hierarchy above the host).
   * Used by soapResolveHostInventoryPaths() to compute the libvirt vpx URI for virt-v2v.
   */
  hostMor: string
  /**
   * VMware Tools install + running state, when reported by vCenter.
   * Used by the migration modal to preflight Live migrations: VSS quiesce
   * (required for a clean NTFS capture on Windows live snapshots) only
   * works if Tools is installed AND running in the guest.
   */
  toolsStatus?: string
  toolsRunningStatus?: string
}

/**
 * Resolved inventory path for a single ESXi host inside a vCenter.
 * Used to build the libvirt vpx URI: vpx://USER@VCENTER/{datacenter}/host[/cluster]/{host}
 */
export interface VmwareHostInventoryPath {
  /** Datacenter name (vCenter inventory). */
  datacenter: string
  /** Cluster name when the host is part of a ClusterComputeResource; null for standalone hosts. */
  cluster: string | null
  /** ESX/ESXi hostname as registered in vCenter (typically the FQDN). */
  host: string
  /**
   * Runtime health aggregate for the host, derived from its connectionState
   * and powerState. Used by the UI to render a status pastille in the tree:
   *   - "ok":   connected + poweredOn (normal operating state)
   *   - "warn": notResponding, standby, or an unknown combination
   *   - "crit": disconnected or poweredOff (host unreachable/halted)
   * "unknown" is returned when vCenter didn't expose the fields.
   */
  status: "ok" | "warn" | "crit" | "unknown"
  /** Raw connectionState from vCenter (connected, notResponding, disconnected). */
  connectionState?: string
  /** Raw powerState from vCenter (poweredOn, poweredOff, standby). */
  powerState?: string
}

/**
 * List all VMs using CreateContainerView + RetrievePropertiesEx.
 * Works on both ESXi (rootFolder = ha-folder-root) and vCenter (rootFolder = group-d1).
 * Optionally accepts a rootFolder override for datacenter-specific queries on vCenter.
 */
export async function soapListVMs(
  session: SoapSession,
  rootFolder?: string
): Promise<VmwareVmSummary[]> {
  const folder = rootFolder || session.rootFolder

  // Step 1: CreateContainerView for all VirtualMachine objects
  const createViewBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:CreateContainerView>
      <urn:_this type="ViewManager">ViewManager</urn:_this>
      <urn:container type="Folder">${folder}</urn:container>
      <urn:type>VirtualMachine</urn:type>
      <urn:recursive>true</urn:recursive>
    </urn:CreateContainerView>
  </soapenv:Body>
</soapenv:Envelope>`

  const viewResult = await soapRequest(session.baseUrl, createViewBody, session.cookie, session.insecureTLS)
  const viewRef = viewResult.text.match(/<returnval type="ContainerView">([^<]+)<\/returnval>/)?.[1]
  if (!viewRef) return []

  // Step 2: RetrievePropertiesEx with TraversalSpec through the ContainerView
  const retrieveBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>name</urn:pathSet>
          <urn:pathSet>runtime.powerState</urn:pathSet>
          <urn:pathSet>config.guestId</urn:pathSet>
          <urn:pathSet>config.guestFullName</urn:pathSet>
          <urn:pathSet>config.hardware.numCPU</urn:pathSet>
          <urn:pathSet>config.hardware.memoryMB</urn:pathSet>
          <urn:pathSet>config.template</urn:pathSet>
          <urn:pathSet>storage.perDatastoreUsage</urn:pathSet>
          <urn:pathSet>runtime.host</urn:pathSet>
          <urn:pathSet>guest.toolsStatus</urn:pathSet>
          <urn:pathSet>guest.toolsRunningStatus</urn:pathSet>
          <urn:pathSet>summary.guest.toolsStatus</urn:pathSet>
          <urn:pathSet>summary.guest.toolsRunningStatus</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="ContainerView">${viewRef}</urn:obj>
          <urn:skip>true</urn:skip>
          <urn:selectSet xsi:type="urn:TraversalSpec" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <urn:name>traverseEntities</urn:name>
            <urn:type>ContainerView</urn:type>
            <urn:path>view</urn:path>
            <urn:skip>false</urn:skip>
          </urn:selectSet>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`

  const sendReq = (body: string) =>
    soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)

  const responseText = await retrieveAllPropertiesEx(
    sendReq,
    retrieveBody,
    session.propertyCollector,
  )

  const propsResult = { text: responseText }

  // Destroy the ContainerView (fire and forget)
  const destroyBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:DestroyView>
      <urn:_this type="ContainerView">${viewRef}</urn:_this>
    </urn:DestroyView>
  </soapenv:Body>
</soapenv:Envelope>`
  soapRequest(session.baseUrl, destroyBody, session.cookie, session.insecureTLS).catch(() => {})

  // Step 3: Parse the response into VM summaries
  const vms: VmwareVmSummary[] = []
  const objRegex = /<objects>([\s\S]*?)<\/objects>/g
  let match: RegExpExecArray | null

  while ((match = objRegex.exec(propsResult.text)) !== null) {
    const block = match[1]
    const moId = block.match(/<obj type="VirtualMachine">([^<]+)<\/obj>/)?.[1] || ""
    if (!moId) continue

    let name = ""
    let powerState = ""
    let guestId = ""
    let guestOS = ""
    let cpu = 0
    let memoryMB = 0
    let template = false
    let committedStorage = 0
    let uncommittedStorage = 0
    let hostMor = ""
    let toolsStatus = ""
    let toolsRunningStatus = ""

    const propRegex = /<propSet>\s*<name>([^<]+)<\/name>\s*<val[^>]*>([\s\S]*?)<\/val>\s*<\/propSet>/g
    let propMatch: RegExpExecArray | null

    while ((propMatch = propRegex.exec(block)) !== null) {
      const propName = propMatch[1]
      const propVal = propMatch[2]

      switch (propName) {
        case "name": name = propVal; break
        case "runtime.powerState": powerState = propVal; break
        case "config.guestId": guestId = propVal; break
        case "config.guestFullName": guestOS = propVal; break
        case "config.hardware.numCPU": cpu = Number.parseInt(propVal, 10) || 0; break
        case "config.hardware.memoryMB": memoryMB = Number.parseInt(propVal, 10) || 0; break
        case "config.template": template = propVal === "true"; break
        case "storage.perDatastoreUsage": {
          const c = propVal.match(/<committed>(\d+)<\/committed>/)
          const u = propVal.match(/<uncommitted>(\d+)<\/uncommitted>/)
          if (c) committedStorage += Number.parseInt(c[1], 10) || 0
          if (u) uncommittedStorage += Number.parseInt(u[1], 10) || 0
          break
        }
        case "runtime.host": {
          // <val type="HostSystem">host-22</val>; the inner text IS the MOR id.
          // Standalone ESXi sessions return an empty/"ha-host" value which we ignore later.
          hostMor = propVal.trim()
          break
        }
        case "guest.toolsStatus":
        case "summary.guest.toolsStatus":
          if (!toolsStatus) toolsStatus = propVal
          break
        case "guest.toolsRunningStatus":
        case "summary.guest.toolsRunningStatus":
          if (!toolsRunningStatus) toolsRunningStatus = propVal
          break
      }
    }

    vms.push({
      moId,
      name: name || moId,
      powerState,
      guestId,
      guestOS,
      cpu,
      memoryMB,
      committedStorage,
      uncommittedStorage,
      template,
      hostMor,
      toolsStatus: toolsStatus || undefined,
      toolsRunningStatus: toolsRunningStatus || undefined,
    })
  }

  return vms
}

// -- vCenter inventory path resolution (HostSystem MOR -> {datacenter, cluster?, host}) --
// Used to build virt-v2v's libvirt vpx URI: vpx://USER@VCENTER/{datacenter}/host[/cluster]/{host}

/** XML-escape a value safely embedded in a SOAP body. */
function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, c => (
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "&" ? "&amp;" :
    c === '"' ? "&quot;" :
    "&apos;"
  ))
}

interface PropValue {
  /** Inner text of <val>...</val>, trimmed. */
  value: string
  /** The xsi:type-style attribute on the val element (present for ManagedObjectReference values). */
  refType?: string
}

/**
 * Bulk-fetch a fixed set of property paths for a list of MORs of the same base type.
 *
 * Uses PropertyCollector.RetrievePropertiesEx with one PropertyFilterSpec containing
 * one propSet (the requested paths) and one objectSet per MOR. The base type drives
 * which propSet applies; subtypes are honored automatically (e.g. requesting type
 * "ComputeResource" returns ClusterComputeResource objects with the cluster name too).
 */
async function soapBatchProps(
  session: SoapSession,
  baseType: string,
  mors: string[],
  paths: string[],
): Promise<Map<string, Record<string, PropValue>>> {
  const out = new Map<string, Record<string, PropValue>>()
  if (mors.length === 0) return out

  const objSpecs = mors
    .map(mor => `<urn:objectSet><urn:obj type="${xmlEscape(baseType)}">${xmlEscape(mor)}</urn:obj></urn:objectSet>`)
    .join("")
  const pathTags = paths.map(p => `<urn:pathSet>${xmlEscape(p)}</urn:pathSet>`).join("")

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>${xmlEscape(baseType)}</urn:type>
          ${pathTags}
        </urn:propSet>
        ${objSpecs}
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)

  // Parse <objects> blocks. We accept any actual subtype on the <obj> tag, since
  // RetrievePropertiesEx returns objects with their concrete type even when the
  // request specifies a base type (this is how we detect ClusterComputeResource).
  for (const objBlock of result.text.matchAll(/<objects>([\s\S]*?)<\/objects>/g)) {
    const block = objBlock[1]
    const morMatch = block.match(/<obj\b[^>]*>([^<]+)<\/obj>/)
    if (!morMatch) continue
    const mor = morMatch[1].trim()

    const props: Record<string, PropValue> = {}
    for (const pm of block.matchAll(/<propSet>\s*<name>([^<]+)<\/name>\s*<val\b([^>]*)>([\s\S]*?)<\/val>\s*<\/propSet>/g)) {
      const name = pm[1]
      const attrs = pm[2] || ""
      const value = pm[3].trim()
      // ManagedObjectReference vals carry BOTH xsi:type="ManagedObjectReference"
      // (the schema type) and type="HostSystem" (the MOR target type). We want the
      // latter, so the lookbehind skips colon-prefixed attribute names like xsi:type.
      const typeAttr = attrs.match(/(?<![\w:])type=(?:"([^"]*)"|'([^']*)')/)
      props[name] = { value, refType: typeAttr ? (typeAttr[1] || typeAttr[2]) : undefined }
    }
    out.set(mor, props)
  }
  return out
}

/**
 * Resolve a list of HostSystem MORs (from VirtualMachine.runtime.host) to their
 * vCenter inventory path: datacenter name, cluster name (if any), host name.
 *
 * Returns an empty map for non-vCenter sessions or when the input list is empty.
 * Hosts that cannot be fully resolved (orphaned, partial inventory, etc.) are
 * silently omitted from the result; callers should treat a missing entry as
 * "unknown, surface a manual-entry fallback to the user".
 *
 * Walks the inventory hierarchy in 4 batched calls (regardless of how many VMs
 * share a given host), so cost is O(unique hosts), not O(VMs).
 */
export async function soapResolveHostInventoryPaths(
  session: SoapSession,
  hostMors: string[],
): Promise<Map<string, VmwareHostInventoryPath>> {
  const out = new Map<string, VmwareHostInventoryPath>()
  if (!session.isVcenter) return out

  const uniqueHosts = [...new Set(hostMors.filter(m => m && m !== "ha-host"))]
  if (uniqueHosts.length === 0) return out

  // Step 1: HostSystem -> { name, parent (CR or CCR), connectionState, powerState }.
  // We also fetch the runtime state here so the UI can render a health pastille
  // on each host row in the inventory tree without an additional SOAP round-trip.
  const hostProps = await soapBatchProps(session, "HostSystem", uniqueHosts, [
    "name",
    "parent",
    "runtime.connectionState",
    "runtime.powerState",
  ])
  console.log(`[soapResolveHostInventoryPaths] step1 HostSystem (${uniqueHosts.length} unique hosts requested):`,
    JSON.stringify([...hostProps.entries()].map(([k, v]) => [k, { name: v.name?.value, parent: v.parent }])))

  // Step 2: deduplicate parent MORs and resolve their { name, parent (HostFolder) }.
  // ClusterComputeResource extends ComputeResource, so a single query against the
  // base type returns both kinds; the actual subtype lives on the <obj> element and
  // is preserved in the parent PropValue.refType from step 1.
  const parentByHost = new Map<string, { mor: string; type: string }>()
  for (const [hostMor, props] of hostProps) {
    const p = props["parent"]
    if (p?.value && p.refType) parentByHost.set(hostMor, { mor: p.value, type: p.refType })
  }
  const uniqueParents = [...new Set([...parentByHost.values()].map(p => p.mor))]
  const parentProps = await soapBatchProps(session, "ComputeResource", uniqueParents, ["name", "parent"])
  console.log(`[soapResolveHostInventoryPaths] step2 ComputeResource (${uniqueParents.length} unique parents):`,
    JSON.stringify([...parentProps.entries()].map(([k, v]) => [k, { name: v.name?.value, parent: v.parent }])))

  // Step 3: deduplicate host-folder MORs and resolve their parent (Datacenter).
  // We assume the folder's parent IS the datacenter; nested host folders are uncommon
  // in practice. If we hit one we'll return a partial path and skip the host.
  const folderByParent = new Map<string, string>()
  for (const [parentMor, props] of parentProps) {
    const p = props["parent"]
    if (p?.value) folderByParent.set(parentMor, p.value)
  }
  const uniqueFolders = [...new Set(folderByParent.values())]
  const folderProps = await soapBatchProps(session, "Folder", uniqueFolders, ["parent"])
  console.log(`[soapResolveHostInventoryPaths] step3 Folder (${uniqueFolders.length} unique folders):`,
    JSON.stringify([...folderProps.entries()].map(([k, v]) => [k, { parent: v.parent }])))

  const dcByFolder = new Map<string, string>()
  for (const [folderMor, props] of folderProps) {
    const p = props["parent"]
    if (p?.value && p.refType === "Datacenter") dcByFolder.set(folderMor, p.value)
  }

  // Step 4: resolve datacenter names.
  const uniqueDcs = [...new Set(dcByFolder.values())]
  const dcProps = await soapBatchProps(session, "Datacenter", uniqueDcs, ["name"])
  console.log(`[soapResolveHostInventoryPaths] step4 Datacenter (${uniqueDcs.length} unique DCs):`,
    JSON.stringify([...dcProps.entries()].map(([k, v]) => [k, { name: v.name?.value }])))

  // Step 5: assemble the path for each requested host.
  for (const hostMor of uniqueHosts) {
    const hp = hostProps.get(hostMor)
    const hostName = hp?.["name"]?.value
    if (!hostName) continue

    const parentInfo = parentByHost.get(hostMor)
    if (!parentInfo) continue
    const pp = parentProps.get(parentInfo.mor)
    if (!pp) continue
    const isCluster = parentInfo.type === "ClusterComputeResource"
    const clusterName = pp["name"]?.value || null

    const folderMor = folderByParent.get(parentInfo.mor)
    if (!folderMor) continue
    const dcMor = dcByFolder.get(folderMor)
    if (!dcMor) continue
    const dcName = dcProps.get(dcMor)?.["name"]?.value
    if (!dcName) continue

    // Derive an aggregate health status from vCenter's connection + power state.
    // Both properties return simple enum strings on HostSystem.runtime; the
    // values are documented in vSphere's vim API reference.
    const connectionState = hp?.["runtime.connectionState"]?.value
    const powerState = hp?.["runtime.powerState"]?.value
    let status: "ok" | "warn" | "crit" | "unknown" = "unknown"
    if (!connectionState && !powerState) {
      status = "unknown"
    } else if (connectionState === "disconnected" || powerState === "poweredOff") {
      status = "crit"
    } else if (connectionState === "connected" && powerState === "poweredOn") {
      status = "ok"
    } else {
      // notResponding, standby, or any state mid-transition.
      status = "warn"
    }

    out.set(hostMor, {
      datacenter: dcName,
      cluster: isCluster ? clusterName : null,
      host: hostName,
      status,
      connectionState,
      powerState,
    })
  }

  return out
}
