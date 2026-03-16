import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

async function soapRequest(baseUrl: string, body: string, cookie: string, insecureTLS: boolean): Promise<{ text: string; cookie?: string }> {
  const opts: any = {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '"urn:vim25/8.0"',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    signal: AbortSignal.timeout(30000),
  }
  if (insecureTLS) {
    opts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
  }
  const res = await fetch(`${baseUrl}/sdk`, opts)
  const text = await res.text()
  const rawCookie = res.headers.get('set-cookie') || ''
  return { text, cookie: rawCookie.split(';')[0] || '' }
}

async function soapLogin(baseUrl: string, username: string, password: string, insecureTLS: boolean): Promise<string> {
  const escUser = username.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escPass = password.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const result = await soapRequest(baseUrl, `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:Login>
      <urn:_this type="SessionManager">ha-sessionmgr</urn:_this>
      <urn:userName>${escUser}</urn:userName>
      <urn:password>${escPass}</urn:password>
    </urn:Login>
  </soapenv:Body>
</soapenv:Envelope>`, '', insecureTLS)

  if (result.text.includes('InvalidLogin') || (result.text.includes('faultstring') && !result.text.includes('returnval'))) {
    throw new Error('ESXi login failed')
  }
  return result.cookie || ''
}

async function soapLogout(baseUrl: string, cookie: string, insecureTLS: boolean): Promise<void> {
  await soapRequest(baseUrl, `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body><urn:Logout><urn:_this type="SessionManager">ha-sessionmgr</urn:_this></urn:Logout></soapenv:Body>
</soapenv:Envelope>`, cookie, insecureTLS).catch(() => {})
}

function extractProp(xml: string, propName: string): string {
  const regex = new RegExp(`<propSet>\\s*<name>${propName.replace(/\./g, '\\.')}</name>\\s*<val[^>]*>([\\s\\S]*?)</val>\\s*</propSet>`)
  return regex.exec(xml)?.[1] || ''
}

/**
 * GET /api/v1/vmware/[id]/vms/[vmid]
 * Get detailed info for a single VM on an ESXi host
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vmid: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { id, vmid } = await params
    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })

    if (!conn || conn.type !== 'vmware') {
      return NextResponse.json({ error: "VMware connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'root'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const esxiUrl = conn.baseUrl.replace(/\/$/, '')

    const cookie = await soapLogin(esxiUrl, username, password, conn.insecureTLS)

    try {
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
          <urn:pathSet>config.hardware.numCPU</urn:pathSet>
          <urn:pathSet>config.hardware.numCoresPerSocket</urn:pathSet>
          <urn:pathSet>config.hardware.memoryMB</urn:pathSet>
          <urn:pathSet>config.version</urn:pathSet>
          <urn:pathSet>config.uuid</urn:pathSet>
          <urn:pathSet>config.firmware</urn:pathSet>
          <urn:pathSet>config.annotation</urn:pathSet>
          <urn:pathSet>guest.toolsStatus</urn:pathSet>
          <urn:pathSet>guest.toolsRunningStatus</urn:pathSet>
          <urn:pathSet>guest.ipAddress</urn:pathSet>
          <urn:pathSet>guest.hostName</urn:pathSet>
          <urn:pathSet>guest.guestFullName</urn:pathSet>
          <urn:pathSet>runtime.powerState</urn:pathSet>
          <urn:pathSet>runtime.bootTime</urn:pathSet>
          <urn:pathSet>runtime.maxCpuUsage</urn:pathSet>
          <urn:pathSet>runtime.maxMemoryUsage</urn:pathSet>
          <urn:pathSet>storage.perDatastoreUsage</urn:pathSet>
          <urn:pathSet>snapshot</urn:pathSet>
          <urn:pathSet>config.hardware.device</urn:pathSet>
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

      const result = await soapRequest(esxiUrl, retrieveBody, cookie, conn.insecureTLS)
      const xml = result.text

      if (xml.includes('ManagedObjectNotFound')) {
        return NextResponse.json({ error: "VM not found" }, { status: 404 })
      }

      const name = extractProp(xml, 'name')
      const guestOS = extractProp(xml, 'config.guestFullName') || extractProp(xml, 'guest.guestFullName')
      const numCPU = parseInt(extractProp(xml, 'config.hardware.numCPU'), 10) || 0
      const numCoresPerSocket = parseInt(extractProp(xml, 'config.hardware.numCoresPerSocket'), 10) || 1
      const memoryMB = parseInt(extractProp(xml, 'config.hardware.memoryMB'), 10) || 0
      const vmxVersion = extractProp(xml, 'config.version')
      const uuid = extractProp(xml, 'config.uuid')
      const firmware = extractProp(xml, 'config.firmware')
      const annotation = extractProp(xml, 'config.annotation')
      const toolsStatus = extractProp(xml, 'guest.toolsStatus')
      const toolsRunningStatus = extractProp(xml, 'guest.toolsRunningStatus')
      const ipAddress = extractProp(xml, 'guest.ipAddress')
      const hostName = extractProp(xml, 'guest.hostName')
      const powerState = extractProp(xml, 'runtime.powerState')
      const bootTime = extractProp(xml, 'runtime.bootTime')
      const maxCpuUsage = parseInt(extractProp(xml, 'runtime.maxCpuUsage'), 10) || 0

      // Storage usage
      const storageXml = extractProp(xml, 'storage.perDatastoreUsage')
      const committedMatch = storageXml.match(/<committed>(\d+)<\/committed>/)
      const uncommittedMatch = storageXml.match(/<uncommitted>(\d+)<\/uncommitted>/)
      const committed = committedMatch ? parseInt(committedMatch[1], 10) : 0
      const uncommitted = uncommittedMatch ? parseInt(uncommittedMatch[1], 10) : 0

      // Parse disks from hardware devices
      const devicesXml = extractProp(xml, 'config.hardware.device')
      const disks: any[] = []
      const networks: any[] = []

      // Parse VirtualDisk devices
      const diskRegex = /xsi:type="VirtualDisk">([\s\S]*?)(?=<VirtualDevice|$)/g
      let diskMatch
      while ((diskMatch = diskRegex.exec(devicesXml)) !== null) {
        const d = diskMatch[1]
        const label = d.match(/<label>([^<]*)<\/label>/)?.[1] || ''
        const capacityBytes = d.match(/<capacityInBytes>(\d+)<\/capacityInBytes>/)?.[1]
        const capacityKB = d.match(/<capacityInKB>(\d+)<\/capacityInKB>/)?.[1]
        const fileName = d.match(/<fileName>([^<]*)<\/fileName>/)?.[1] || ''
        const thinProvisioned = d.includes('<thinProvisioned>true</thinProvisioned>')
        disks.push({
          label,
          capacityBytes: capacityBytes ? parseInt(capacityBytes, 10) : (capacityKB ? parseInt(capacityKB, 10) * 1024 : 0),
          fileName,
          thinProvisioned,
        })
      }

      // Parse VirtualEthernetCard (network adapters)
      const netRegex = /xsi:type="Virtual(?:Vmxnet3|E1000e?|Vmxnet2?)">([\s\S]*?)(?=<VirtualDevice|$)/g
      let netMatch
      while ((netMatch = netRegex.exec(devicesXml)) !== null) {
        const n = netMatch[1]
        const label = n.match(/<label>([^<]*)<\/label>/)?.[1] || ''
        const mac = n.match(/<macAddress>([^<]*)<\/macAddress>/)?.[1] || ''
        const network = n.match(/<summary>([^<]*)<\/summary>/)?.[1] || ''
        const connected = !n.includes('<connected>false</connected>')
        networks.push({ label, macAddress: mac, network, connected })
      }

      // Snapshots count
      const snapshotXml = extractProp(xml, 'snapshot')
      const snapshotCount = (snapshotXml.match(/<snapshot type="VirtualMachineSnapshot"/g) || []).length

      const sockets = numCPU > 0 && numCoresPerSocket > 0 ? Math.ceil(numCPU / numCoresPerSocket) : 1

      return NextResponse.json({
        data: {
          vmid,
          name: name || vmid,
          guestOS,
          numCPU,
          numCoresPerSocket,
          sockets,
          memoryMB,
          vmxVersion,
          uuid,
          firmware: firmware || 'bios',
          annotation,
          toolsStatus,
          toolsRunningStatus,
          ipAddress,
          hostName,
          powerState,
          status: powerState === 'poweredOn' ? 'running' : powerState === 'suspended' ? 'suspended' : 'stopped',
          bootTime,
          maxCpuUsage,
          committed,
          uncommitted,
          provisioned: committed + uncommitted,
          disks,
          networks,
          snapshotCount,
          connectionId: conn.id,
          connectionName: conn.name,
        }
      })
    } finally {
      soapLogout(esxiUrl, cookie, conn.insecureTLS)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
