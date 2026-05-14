// Stream a single backup file (e.g. qemu-server.conf.blob, fw.conf.blob)
// from PBS to the browser. PBS exposes
//   GET /admin/datastore/{store}/file-download?backup-type=...&backup-id=...&backup-time=...&file-name=...&ns=...
// which returns the raw bytes of the named .blob (or the index of a
// .didx/.fidx — useful only for advanced debugging, not for end users).
//
// We don't go through pbsFetch because that helper unconditionally parses
// the body as JSON. Forward the upstream body as-is with a download
// Content-Disposition so the browser saves the file under its original
// name.

import { cookies } from 'next/headers'

import { Agent, request } from 'undici'

import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'

export const runtime = 'nodejs'

let insecureAgent: Agent | null = null

function getInsecureAgent(): Agent {
  if (!insecureAgent) insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })

return insecureAgent
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; backupId: string }> | { id: string; backupId: string } },
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const rawBackupId = (params as any)?.backupId

    if (!id || !rawBackupId) {
      return new Response('Missing params', { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', id)

    if (denied) return denied

    const access = await assertVdcPbsAccess(id)

    if (access instanceof Response) return access

    const url = new URL(req.url)
    const fileName = url.searchParams.get('file')

    if (!fileName) {
      return new Response('Missing file query param', { status: 400 })
    }


    // Restricted to .blob to avoid serving up the chunk-index of a
    // .didx/.fidx — those bytes are useless on their own (they reference
    // chunks in the datastore the browser can't reassemble). For .pxar
    // contents the caller must use the existing pxar browser path.
    if (!fileName.endsWith('.blob')) {
      return new Response('Only .blob files are downloadable; use the file restore for VM disks', { status: 400 })
    }

    // Same anchor-on-the-end parsing as the content route. Sub-namespaces
    // contain '/', so a left-aligned split misassigns segments.
    const decoded = decodeURIComponent(rawBackupId)
    const parts = decoded.split('/')

    if (parts.length < 4) {
      return new Response('Invalid backupId format', { status: 400 })
    }

    const datastore = parts[0]
    const timestamp = parts[parts.length - 1]
    const vmid = parts[parts.length - 2]
    const backupType = parts[parts.length - 3]
    const namespaceFromId = parts.slice(1, parts.length - 3).join('/')
    const ns = url.searchParams.get('ns') || namespaceFromId

    if (access.kind === 'tenant' && !access.allowed.some(a => a.datastore === datastore && a.namespace === ns)) {
      return new Response('Backup not accessible for this tenant', { status: 403 })
    }

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    // PBS file-download endpoint. PBS returns the raw bytes (no
    // Content-Disposition by default), so we add one downstream.
    const qs = new URLSearchParams({
      'backup-type': backupType,
      'backup-id': vmid,
      'backup-time': timestamp,
      'file-name': fileName,
    })

    if (ns) qs.set('ns', ns)

    const upstreamUrl = `${conn.baseUrl.replace(/\/$/, '')}/api2/json/admin/datastore/${encodeURIComponent(datastore)}/file-download?${qs.toString()}`
    const dispatcher = conn.insecureDev ? getInsecureAgent() : undefined

    const upstream = await request(upstreamUrl, {
      method: 'GET',
      headers: {
        Authorization: `PBSAPIToken=${conn.apiToken}`,
      },
      dispatcher,
    })

    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      const errText = await upstream.body.text()


return new Response(`PBS ${upstream.statusCode}: ${errText.slice(0, 500)}`, { status: upstream.statusCode })
    }

    // Forward the body as a Web stream so Next.js doesn't buffer the whole
    // file in memory. .blob configs are tiny in practice but the contract
    // is the same for any future expansion.
    const body = upstream.body as unknown as ReadableStream<Uint8Array>
    const contentLength = upstream.headers['content-length']

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName.replaceAll('"', '')}"`,
      'Cache-Control': 'no-store',
    }

    if (typeof contentLength === 'string') headers['Content-Length'] = contentLength

    return new Response(body, { status: 200, headers })
  } catch (e: any) {
    console.error('PBS download error:', e)

return new Response('PBS download failed', { status: 500 })
  }
}
