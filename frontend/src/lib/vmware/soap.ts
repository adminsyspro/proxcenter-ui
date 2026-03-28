/**
 * Shared VMware ESXi SOAP helpers
 * Used by both the VMware API routes and the migration pipeline
 */

export interface SoapSession {
  baseUrl: string
  cookie: string
  insecureTLS: boolean
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
  const escUser = username.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const escPass = password.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  const loginBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:Login>
      <urn:_this type="SessionManager">ha-sessionmgr</urn:_this>
      <urn:userName>${escUser}</urn:userName>
      <urn:password>${escPass}</urn:password>
    </urn:Login>
  </soapenv:Body>
</soapenv:Envelope>`

  const result = await soapRequest(baseUrl, loginBody, "", insecureTLS)
  if (result.text.includes("InvalidLogin") || (result.text.includes("faultstring") && !result.text.includes("returnval"))) {
    const fault = result.text.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1] || "Authentication failed"
    throw new Error(`ESXi login failed: ${fault}`)
  }
  return { baseUrl, cookie: result.cookie || "", insecureTLS }
}

/** Logout the SOAP session */
export async function soapLogout(session: SoapSession): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body><urn:Logout><urn:_this type="SessionManager">ha-sessionmgr</urn:_this></urn:Logout></soapenv:Body>
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
      <urn:_this type="PropertyCollector">ha-property-collector</urn:_this>
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
      <urn:_this type="PropertyCollector">ha-property-collector</urn:_this>
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
      <urn:_this type="PropertyCollector">ha-property-collector</urn:_this>
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

/** Wait for an NFC lease to become ready and return device download URLs */
export async function soapWaitForNfcLease(session: SoapSession, leaseMor: string): Promise<NfcLeaseDeviceUrl[]> {
  const host = session.baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">ha-property-collector</urn:_this>
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

    disks.push({ label, fileName, capacityBytes, thinProvisioned, datastoreName, relativePath })
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

  return {
    name, guestOS, guestId, numCPU, numCoresPerSocket, sockets, memoryMB,
    firmware, uuid, vmxVersion, powerState, committed, disks, nics, snapshotCount,
  }
}

/**
 * Build HTTPS URLs to download a VMDK from ESXi datastore browser.
 * ESXi exposes files at: https://host/folder/<path>?dcPath=ha-datacenter&dsName=<datastore>
 *
 * Returns [flatUrl, descriptorUrl]:
 * - flatUrl: the -flat.vmdk file (raw disk data, standard for split VMDK)
 * - descriptorUrl: the .vmdk descriptor itself (works for monolithic thick disks)
 */
export function buildVmdkDownloadUrl(esxiBaseUrl: string, disk: EsxiDiskInfo): string {
  const host = esxiBaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  const flatPath = disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
  return `https://${host}/folder/${encodeURIComponent(flatPath).replace(/%2F/g, "/")}?dcPath=ha-datacenter&dsName=${encodeURIComponent(disk.datastoreName)}`
}

export function buildVmdkDescriptorUrl(esxiBaseUrl: string, disk: EsxiDiskInfo): string {
  const host = esxiBaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  return `https://${host}/folder/${encodeURIComponent(disk.relativePath).replace(/%2F/g, "/")}?dcPath=ha-datacenter&dsName=${encodeURIComponent(disk.datastoreName)}`
}
