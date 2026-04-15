import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { soapLogin, soapLogout, soapRequest, extractProp, soapResolveHostInventoryPaths } from "@/lib/vmware/soap"

export const runtime = "nodejs"

/**
 * GET /api/v1/vmware/[id]/vms/[vmid]
 * Get detailed info for a single VM on a VMware ESXi host or vCenter
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
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true, subType: true, vmwareDatacenter: true },
    })

    if (!conn || conn.type !== 'vmware') {
      return NextResponse.json({ error: "VMware connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'root'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const vmwareUrl = conn.baseUrl.replace(/\/$/, '')

    // Login via shared SOAP client (auto-discovers MORs for ESXi or vCenter)
    const session = await soapLogin(vmwareUrl, username, password, conn.insecureTLS)

    if (conn.vmwareDatacenter) {
      session.datacenterPath = conn.vmwareDatacenter
    }

    try {
      // Use session.propertyCollector for dynamic MOR (works on both ESXi and vCenter)
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
          <urn:pathSet>runtime.host</urn:pathSet>
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
      const xml = result.text

      if (xml.includes('ManagedObjectNotFound')) {
        return NextResponse.json({ error: "VM not found" }, { status: 404 })
      }

      const name = extractProp(xml, 'name')
      const guestOS = extractProp(xml, 'config.guestFullName') || extractProp(xml, 'guest.guestFullName')
      const numCPU = Number.parseInt(extractProp(xml, 'config.hardware.numCPU'), 10) || 0
      const numCoresPerSocket = Number.parseInt(extractProp(xml, 'config.hardware.numCoresPerSocket'), 10) || 1
      const memoryMB = Number.parseInt(extractProp(xml, 'config.hardware.memoryMB'), 10) || 0
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
      const maxCpuUsage = Number.parseInt(extractProp(xml, 'runtime.maxCpuUsage'), 10) || 0

      // Storage usage
      const storageXml = extractProp(xml, 'storage.perDatastoreUsage')
      const committedMatch = storageXml.match(/<committed>(\d+)<\/committed>/)
      const uncommittedMatch = storageXml.match(/<uncommitted>(\d+)<\/uncommitted>/)
      const committed = committedMatch ? Number.parseInt(committedMatch[1], 10) : 0
      const uncommitted = uncommittedMatch ? Number.parseInt(uncommittedMatch[1], 10) : 0

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
          capacityBytes: capacityBytes ? Number.parseInt(capacityBytes, 10) : (capacityKB ? Number.parseInt(capacityKB, 10) * 1024 : 0),
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

      // vCenter inventory path (datacenter/cluster/host) for the libvirt vpx URI
      // used by virt-v2v migrations. Best-effort: undefined fields fall back to
      // manual entry (or pipeline error) at migration time.
      const hostMor = extractProp(xml, 'runtime.host')
      let vcenterDatacenter: string | undefined
      let vcenterCluster: string | undefined
      let vcenterHost: string | undefined
      let vcenterHostStatus: "ok" | "warn" | "crit" | "unknown" | undefined
      let vcenterHostConnectionState: string | undefined
      let vcenterHostPowerState: string | undefined
      console.log(`[vmware/vms/${vmid}] runtime.host extraction: isVcenter=${session.isVcenter}, hostMor=${JSON.stringify(hostMor)}`)
      if (hostMor && session.isVcenter) {
        try {
          const paths = await soapResolveHostInventoryPaths(session, [hostMor])
          const path = paths.get(hostMor)
          console.log(`[vmware/vms/${vmid}] inventory path resolution: hostMor=${hostMor}, resolved=${path ? JSON.stringify(path) : 'NULL'}`)
          if (path) {
            vcenterDatacenter = path.datacenter
            vcenterCluster = path.cluster ?? undefined
            vcenterHost = path.host
            vcenterHostStatus = path.status
            vcenterHostConnectionState = path.connectionState
            vcenterHostPowerState = path.powerState
          }
        } catch (resolveErr) {
          console.warn(`[vmware/vms/${vmid}] Failed to resolve vCenter inventory path for ${hostMor}: ${(resolveErr as Error)?.message || resolveErr}`)
        }
      } else if (session.isVcenter) {
        console.warn(`[vmware/vms/${vmid}] vCenter session but no runtime.host extracted from VM properties; the migration will fail with "vcenterDatacenter required"`)
      }

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
          vcenterDatacenter,
          vcenterCluster,
          vcenterHost,
          vcenterHostStatus,
          vcenterHostConnectionState,
          vcenterHostPowerState,
        }
      })
    } finally {
      soapLogout(session)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
