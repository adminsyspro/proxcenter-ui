import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type EsxiVm = {
  vmid: string
  name: string
  status: string  // 'running' | 'stopped' | 'suspended'
  cpu?: number
  memory_size_MiB?: number
  power_state?: string
  guest_OS?: string
  committed?: number  // disk usage in bytes
  uncommitted?: number  // provisioned but unused
}

/** Send a SOAP request to the ESXi /sdk endpoint */
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
  if (!res.ok && !text.includes('returnval')) {
    throw new Error(`SOAP error ${res.status}: ${text.substring(0, 200)}`)
  }
  // Extract just the cookie name=value part from set-cookie header
  const rawCookie = res.headers.get('set-cookie') || ''
  const cookieValue = rawCookie.split(';')[0] || ''
  return { text, cookie: cookieValue }
}

/** Login via SOAP and return session cookie */
async function soapLogin(baseUrl: string, username: string, password: string, insecureTLS: boolean): Promise<string> {
  const escUser = username.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escPass = password.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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

  const result = await soapRequest(baseUrl, loginBody, '', insecureTLS)
  if (result.text.includes('InvalidLogin') || (result.text.includes('faultstring') && !result.text.includes('returnval'))) {
    const fault = result.text.match(/<faultstring>([^<]*)<\/faultstring>/)?.[1] || 'Authentication failed'
    throw new Error(`ESXi login failed: ${fault}`)
  }
  return result.cookie || ''
}

/** Logout the SOAP session */
async function soapLogout(baseUrl: string, cookie: string, insecureTLS: boolean): Promise<void> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:Logout>
      <urn:_this type="SessionManager">ha-sessionmgr</urn:_this>
    </urn:Logout>
  </soapenv:Body>
</soapenv:Envelope>`
  await soapRequest(baseUrl, body, cookie, insecureTLS).catch(() => {})
}

/** List all VMs using SOAP PropertyCollector */
async function soapListVMs(baseUrl: string, cookie: string, insecureTLS: boolean): Promise<EsxiVm[]> {
  // Create a ContainerView for all VirtualMachine objects
  const createViewBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:CreateContainerView>
      <urn:_this type="ViewManager">ViewManager</urn:_this>
      <urn:container type="Folder">ha-folder-vm</urn:container>
      <urn:type>VirtualMachine</urn:type>
      <urn:recursive>true</urn:recursive>
    </urn:CreateContainerView>
  </soapenv:Body>
</soapenv:Envelope>`

  const viewResult = await soapRequest(baseUrl, createViewBody, cookie, insecureTLS)
  const viewRef = viewResult.text.match(/<returnval type="ContainerView">([^<]+)<\/returnval>/)?.[1]
  if (!viewRef) {
    return []
  }

  // Use PropertyCollector to retrieve VM properties via the ContainerView
  const retrieveBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">ha-property-collector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>name</urn:pathSet>
          <urn:pathSet>runtime.powerState</urn:pathSet>
          <urn:pathSet>config.hardware.numCPU</urn:pathSet>
          <urn:pathSet>config.hardware.memoryMB</urn:pathSet>
          <urn:pathSet>config.guestFullName</urn:pathSet>
          <urn:pathSet>storage.perDatastoreUsage</urn:pathSet>
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

  const propsResult = await soapRequest(baseUrl, retrieveBody, cookie, insecureTLS)

  // Destroy the ContainerView (fire and forget)
  const destroyBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:DestroyView>
      <urn:_this type="ContainerView">${viewRef}</urn:_this>
    </urn:DestroyView>
  </soapenv:Body>
</soapenv:Envelope>`
  soapRequest(baseUrl, destroyBody, cookie, insecureTLS).catch(() => {})

  return parseVMProperties(propsResult.text)
}

/** Parse SOAP PropertyCollector response into VM list */
function parseVMProperties(xml: string): EsxiVm[] {
  const vms: EsxiVm[] = []

  // Each VM is in an <objects> block inside <returnval>
  const objRegex = /<objects>([\s\S]*?)<\/objects>/g
  let match: RegExpExecArray | null

  while ((match = objRegex.exec(xml)) !== null) {
    const block = match[1]

    // Extract VM moid from <obj type="VirtualMachine">XX</obj>
    const vmid = block.match(/<obj type="VirtualMachine">([^<]+)<\/obj>/)?.[1] || ''

    let name = ''
    let powerState = ''
    let numCPU = 0
    let memoryMB = 0
    let guestOS = ''
    let committed = 0
    let uncommitted = 0

    // Extract properties — <val> may have xsi:type attribute, some vals contain nested XML
    const propRegex = /<propSet>\s*<name>([^<]+)<\/name>\s*<val[^>]*>([\s\S]*?)<\/val>\s*<\/propSet>/g
    let propMatch: RegExpExecArray | null

    while ((propMatch = propRegex.exec(block)) !== null) {
      const propName = propMatch[1]
      const propVal = propMatch[2]

      switch (propName) {
        case 'name': name = propVal; break
        case 'runtime.powerState': powerState = propVal; break
        case 'config.hardware.numCPU': numCPU = parseInt(propVal, 10) || 0; break
        case 'config.hardware.memoryMB': memoryMB = parseInt(propVal, 10) || 0; break
        case 'config.guestFullName': guestOS = propVal; break
        case 'storage.perDatastoreUsage': {
          const c = propVal.match(/<committed>(\d+)<\/committed>/)
          const u = propVal.match(/<uncommitted>(\d+)<\/uncommitted>/)
          if (c) committed += parseInt(c[1], 10) || 0
          if (u) uncommitted += parseInt(u[1], 10) || 0
          break
        }
      }
    }

    if (vmid) {
      vms.push({
        vmid,
        name: name || vmid,
        status: powerState === 'poweredOn' ? 'running' : powerState === 'suspended' ? 'suspended' : 'stopped',
        cpu: numCPU || undefined,
        memory_size_MiB: memoryMB ? memoryMB : undefined,
        power_state: powerState,
        guest_OS: guestOS || undefined,
        committed: committed || undefined,
        uncommitted: uncommitted || undefined,
      })
    }
  }

  return vms
}

/**
 * GET /api/v1/vmware/[id]/vms
 * List VMs on a VMware ESXi host via SOAP API (works on standalone ESXi + vCenter)
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { id } = await params
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

    // Login via SOAP
    const cookie = await soapLogin(esxiUrl, username, password, conn.insecureTLS)

    try {
      const vms = await soapListVMs(esxiUrl, cookie, conn.insecureTLS)
      return NextResponse.json({ data: { vms, connectionName: conn.name } })
    } finally {
      soapLogout(esxiUrl, cookie, conn.insecureTLS)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
