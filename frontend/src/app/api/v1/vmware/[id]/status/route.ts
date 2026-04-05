import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { soapLogin, soapLogout, soapRequest } from "@/lib/vmware/soap"

export const runtime = "nodejs"

/**
 * GET /api/v1/vmware/[id]/status
 * Test connectivity to a VMware ESXi host or vCenter via SOAP API
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
      select: { id: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true, subType: true, vmwareDatacenter: true },
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
    let session
    try {
      session = await soapLogin(vmwareUrl, username, password, conn.insecureTLS)
    } catch (e: any) {
      if (e?.message?.includes('login failed')) {
        return NextResponse.json({ data: { status: 'auth_error', host: vmwareUrl, warning: 'Invalid credentials' } })
      }
      // Host unreachable or other connectivity issue
      return NextResponse.json({ error: e?.message || "VMware host unreachable" }, { status: 502 })
    }

    try {
      // Fetch license info using discovered PropertyCollector MOR
      let licenseEdition = 'unknown'
      let licenseFull = false
      try {
        // Use dynamic MOR names from session (works on both ESXi and vCenter)
        const licManagerMor = session.isVcenter ? 'LicenseManager' : 'ha-license-manager'
        const licBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>
      <urn:specSet>
        <urn:propSet><urn:type>LicenseManager</urn:type><urn:pathSet>licenses</urn:pathSet></urn:propSet>
        <urn:objectSet><urn:obj type="LicenseManager">${licManagerMor}</urn:obj></urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`
        const licResult = await soapRequest(session.baseUrl, licBody, session.cookie, session.insecureTLS, 10000)
        const licText = licResult.text
        const editionMatch = licText.match(/<editionKey>([^<]+)<\/editionKey>/)
        if (editionMatch) licenseEdition = editionMatch[1]
        const freeEditions = ['esxiFree', 'esx.hypervisor.cpuPackageCoreLimited', 'esx.hypervisor']
        const isFree = freeEditions.some(e => licText.includes(e))
        const isEval = licenseEdition.toLowerCase().includes('eval') || licText.includes('>Evaluation<')
        licenseFull = !isFree || isEval
      } catch {
        // License check failed - assume free to be safe
      }

      // Extract version info from the login response is not available here,
      // but we can use RetrieveServiceContent which was already done during soapLogin.
      // For version, we do a lightweight ServiceContent query.
      let version: string | undefined
      try {
        const scBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveServiceContent>
      <urn:_this type="ServiceInstance">ServiceInstance</urn:_this>
    </urn:RetrieveServiceContent>
  </soapenv:Body>
</soapenv:Envelope>`
        const scResult = await soapRequest(session.baseUrl, scBody, session.cookie, session.insecureTLS, 10000)
        version = scResult.text.match(/<fullName>([^<]*)<\/fullName>/)?.[1]
      } catch {
        // Version check failed - not critical
      }

      return NextResponse.json({
        data: {
          status: 'online',
          host: vmwareUrl,
          version,
          licenseEdition,
          licenseFull,
          isVcenter: session.isVcenter,
          subType: session.isVcenter ? 'vcenter' : 'esxi',
        }
      })
    } finally {
      soapLogout(session)
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
