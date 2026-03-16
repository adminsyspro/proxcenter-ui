import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/vmware/[id]/status
 * Test connectivity to a VMware ESXi host (standalone or vCenter)
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
      select: { id: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })

    if (!conn || conn.type !== 'vmware') {
      return NextResponse.json({ error: "VMware connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'root'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const esxiUrl = conn.baseUrl.replace(/\/$/, '')

    const fetchOpts: any = {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"urn:vim25/8.0"' },
      signal: AbortSignal.timeout(15000),
    }
    if (conn.insecureTLS) {
      fetchOpts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
    }

    // Try SOAP login — works on both standalone ESXi and vCenter
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

    const res = await fetch(`${esxiUrl}/sdk`, { ...fetchOpts, body: loginBody }).catch(() => null)

    if (!res) {
      return NextResponse.json({ error: "ESXi host unreachable" }, { status: 502 })
    }

    const text = await res.text()

    if (text.includes('InvalidLogin')) {
      return NextResponse.json({ data: { status: 'auth_error', host: esxiUrl, warning: 'Invalid credentials' } })
    }

    if (text.includes('returnval') || text.includes('LoginResponse')) {
      // Logout to clean up
      const cookie = (res.headers.get('set-cookie') || '').split(';')[0]
      const logoutBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body><urn:Logout><urn:_this type="SessionManager">ha-sessionmgr</urn:_this></urn:Logout></soapenv:Body>
</soapenv:Envelope>`
      const logoutOpts: any = {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"urn:vim25/8.0"', ...(cookie ? { Cookie: cookie } : {}) },
      }
      if (conn.insecureTLS) {
        logoutOpts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
      }
      // Fetch license info before logout
      let licenseEdition = 'unknown'
      let licenseFull = false
      try {
        const licBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveProperties>
      <urn:_this type="PropertyCollector">ha-property-collector</urn:_this>
      <urn:specSet>
        <urn:propSet><urn:type>LicenseManager</urn:type><urn:pathSet>licenses</urn:pathSet></urn:propSet>
        <urn:objectSet><urn:obj type="LicenseManager">ha-license-manager</urn:obj></urn:objectSet>
      </urn:specSet>
    </urn:RetrieveProperties>
  </soapenv:Body>
</soapenv:Envelope>`
        const licOpts: any = {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"urn:vim25/8.0"', ...(cookie ? { Cookie: cookie } : {}) },
          signal: AbortSignal.timeout(10000),
        }
        if (conn.insecureTLS) {
          licOpts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
        }
        const licRes = await fetch(`${esxiUrl}/sdk`, { ...licOpts, body: licBody })
        const licText = await licRes.text()
        // editionKey values:
        //   Free: "esxiFree", "esx.hypervisor.cpuPackageCoreLimited", "esx.hypervisor"
        //   Paid: "esxiStandard", "esxiEnterprise", "esxiEnterprisePlus", "esxiEssentials"
        //   Eval: contains "eval" or "Evaluation"
        const editionMatch = licText.match(/<editionKey>([^<]+)<\/editionKey>/)
        if (editionMatch) licenseEdition = editionMatch[1]
        const freeEditions = ['esxiFree', 'esx.hypervisor.cpuPackageCoreLimited', 'esx.hypervisor']
        const isFree = freeEditions.some(e => licText.includes(e))
        const isEval = licenseEdition.toLowerCase().includes('eval') || licText.includes('>Evaluation<')
        licenseFull = !isFree || isEval
      } catch {
        // License check failed — assume free to be safe
      }

      fetch(`${esxiUrl}/sdk`, { ...logoutOpts, body: logoutBody }).catch(() => {})

      // Extract version info
      const version = text.match(/<fullName>([^<]*)<\/fullName>/)?.[1]
      return NextResponse.json({ data: { status: 'online', host: esxiUrl, version, licenseEdition, licenseFull } })
    }

    // Host responded but login unclear
    return NextResponse.json({ data: { status: 'online', host: esxiUrl, warning: 'Host reachable, authentication not fully verified' } })
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
