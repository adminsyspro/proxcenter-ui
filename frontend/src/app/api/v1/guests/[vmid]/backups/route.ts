import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { formatBytes } from "@/utils/format"
import { getDateLocale } from "@/lib/i18n/date"

export const runtime = "nodejs"

/**
 * Strip scheme, path and port so a PBS connection baseUrl (e.g.
 * "https://10.0.0.1:8007") can be compared to a PVE pbs-storage `server`
 * (a bare host or IP, e.g. "10.0.0.1").
 */
function normalizeHost(s?: string | null): string {
  if (!s) return ''

  return s.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].trim().toLowerCase()
}

/**
 * GET /api/v1/guests/[vmid]/backups
 * 
 * Récupère toutes les sauvegardes d'une VM depuis tous les PBS configurés.
 * 
 * Query params:
 * - type: 'vm' | 'ct' (optionnel, pour filtrer par type)
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ vmid: string }> | { vmid: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vmid = (params as any)?.vmid

    if (!vmid) {
      return NextResponse.json({ error: "Missing vmid parameter" }, { status: 400 })
    }

    // RBAC: Check backup.view permission
    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)

    if (denied) return denied

    const cookieStore = await cookies()
    const dateLocale = getDateLocale(cookieStore.get('NEXT_LOCALE')?.value || 'en')

    const url = new URL(req.url)
    const typeFilter = url.searchParams.get('type') // 'vm' | 'ct'
    const connectionId = url.searchParams.get('connectionId') // the guest's PVE connection

    // Récupérer toutes les connexions PBS visibles. Provider sees its own
    // PBS via tenant prisma; vDC tenants reach PBS connections referenced
    // by their vDC bindings (vdc_pbs_namespaces) using the global client +
    // an id whitelist, mirroring `/api/v1/connections?type=pbs`.
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const sessionPrisma = await getSessionPrisma()
    // iaas uses GLOBAL + vDC id filter (provider-owned PBS, tenant can't see them via session);
    // provider uses GLOBAL with no filter (all PBS); msp uses SESSION (its own owned PBS).
    const connPrisma = infra.kind === 'msp' ? sessionPrisma : globalPrisma
    const pbsWhere: any = { type: 'pbs' }
    if (infra.kind === 'iaas') pbsWhere.id = { in: [...infra.vdcScope.pbsConnectionIds] }
    const pbsConnections = await connPrisma.connection.findMany({
      where: pbsWhere,
      select: {
        id: true,
        name: true,
        baseUrl: true,
        insecureTLS: true,
        apiTokenEnc: true,
      }
    })

    if (pbsConnections.length === 0) {
      return NextResponse.json({
        data: {
          backups: [],
          stats: { total: 0, totalSize: 0, totalSizeFormatted: '0 B' },
          pbsConfigured: false,
        }
      })
    }

    // Is one of these PBS connections actually the backup target of THIS guest's
    // cluster? We compare the cluster's pbs-type storage host(s) against the PBS
    // connection hosts. A cluster that backs up to a PBS we are not connected to
    // (different host) counts as "no PBS configured" — we cannot read its
    // snapshots — which is what drives the empty-state message.
    let pbsConfigured = pbsConnections.length > 0
    if (connectionId) {
      try {
        const connHosts = new Set(
          pbsConnections.map(c => normalizeHost(c.baseUrl)).filter(Boolean)
        )
        const pveConn = await getConnectionById(connectionId)
        const pveStorages = await pveFetch<any[]>(pveConn, '/storage')

        pbsConfigured = (pveStorages || []).some(
          (s: any) => s?.type === 'pbs' && connHosts.has(normalizeHost(s.server))
        )
      } catch {
        // Cannot read the cluster storage config: fall back to "a PBS connection
        // exists" so we never wrongly claim none is configured.
        pbsConfigured = pbsConnections.length > 0
      }
    }

    const allBackups: any[] = []
    const warnings: string[] = []

    // Interroger chaque PBS en parallèle
    const pbsPromises = pbsConnections.map(async (pbs) => {
      if (!pbs.apiTokenEnc || !pbs.baseUrl) return []

      const conn = {
        id: pbs.id,
        name: pbs.name,
        baseUrl: pbs.baseUrl,
        apiToken: decryptSecret(pbs.apiTokenEnc),
        insecureDev: !!pbs.insecureTLS,
      }

      try {
        // Récupérer la liste des datastores
        const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

        // Pour chaque datastore, chercher les backups de cette VM
        const datastorePromises = (datastores || []).map(async (ds) => {
          const storeName = ds.store || ds.name

          if (!storeName) return []

          try {
            // List all namespaces (empty string = root, plus sub-namespaces)
            let namespaces: string[] = ['']

            try {
              const nsData = await pbsFetch<any[]>(
                conn,
                `/admin/datastore/${encodeURIComponent(storeName)}/namespace`
              )

              if (Array.isArray(nsData)) {
                const subNs = nsData.map(n => n.ns || '').filter(Boolean)
                namespaces = ['', ...subNs]
              }
            } catch {
              // Older PBS versions may not support namespace endpoint
            }

            // Fetch snapshots for each namespace in parallel
            const nsPromises = namespaces.map(async (ns) => {
              const nsParam = ns ? `?ns=${encodeURIComponent(ns)}` : ''
              const snapshots = await pbsFetch<any[]>(
                conn,
                `/admin/datastore/${encodeURIComponent(storeName)}/snapshots${nsParam}`
              )

              return (snapshots || [])
                .filter(snap => {
                  const backupId = String(snap['backup-id'] || '')
                  const matchVmid = backupId === String(vmid)
                  const matchType = !typeFilter || snap['backup-type'] === typeFilter

                  return matchVmid && matchType
                })
                .map(snap => {
                  const backupTime = snap['backup-time']
                    ? new Date(snap['backup-time'] * 1000)
                    : null

                  const backupTimeIso = backupTime?.toISOString().replace(/\.\d{3}Z$/, 'Z') || ''
                  const backupPath = `backup/${snap['backup-type']}/${snap['backup-id']}/${backupTimeIso}`

                  return {
                    id: `${storeName}/${ns ? ns + '/' : ''}${snap['backup-type']}/${snap['backup-id']}/${snap['backup-time']}`,

                    // Infos PBS
                    pbsId: pbs.id,
                    pbsName: pbs.name,
                    pbsUrl: pbs.baseUrl,

                    // Infos datastore
                    datastore: storeName,
                    namespace: ns,

                    // Path pour construire le volid PVE (sans le storage prefix)
                    backupPath,

                    // Infos backup
                    backupType: snap['backup-type'],
                    backupId: snap['backup-id'],
                    vmName: snap.comment || '',
                    backupTime: snap['backup-time'] || 0,
                    backupTimeFormatted: backupTime?.toLocaleString(dateLocale) || '-',
                    backupTimeIso: backupTimeIso,

                    // Taille
                    size: snap.size || 0,
                    sizeFormatted: formatBytes(snap.size || 0),

                    // Fichiers
                    files: snap.files || [],
                    fileCount: snap.files?.length || 0,

                    // Vérification
                    verification: snap.verification || null,
                    verified: snap.verification?.state === 'ok',
                    verifiedAt: snap.verification?.upid
                      ? new Date((snap.verification['last-run'] || 0) * 1000).toLocaleString(dateLocale)
                      : null,

                    // Protection
                    protected: snap.protected || false,

                    // Owner
                    owner: snap.owner || '',
                    comment: snap.comment || '',
                  }
                })
            })

            const nsResults = await Promise.all(nsPromises)

            return nsResults.flat()
          } catch (e: any) {
            console.warn(`Failed to get snapshots for ${pbs.name}/${storeName}:`, e)
            warnings.push(`${pbs.name}/${storeName}: ${e?.message || String(e)}`)

return []
          }
        })

        const results = await Promise.all(datastorePromises)

        
return results.flat()
      } catch (e: any) {
        console.warn(`Failed to query PBS ${pbs.name}:`, e)
        warnings.push(`PBS ${pbs.name}: ${e?.message || String(e)}`)

return []
      }
    })

    const results = await Promise.all(pbsPromises)

    results.forEach(backups => allBackups.push(...backups))

    // Trier par date (plus récent en premier)
    allBackups.sort((a, b) => b.backupTime - a.backupTime)

    // Stats
    const totalSize = allBackups.reduce((sum, b) => sum + (b.size || 0), 0)

    const stats = {
      total: allBackups.length,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      verifiedCount: allBackups.filter(b => b.verified).length,
      protectedCount: allBackups.filter(b => b.protected).length,
      oldestBackup: allBackups.length > 0 ? allBackups[allBackups.length - 1].backupTimeFormatted : null,
      newestBackup: allBackups.length > 0 ? allBackups[0].backupTimeFormatted : null,
    }

    return NextResponse.json({
      data: {
        vmid,
        backups: allBackups,
        stats,
        warnings,
        pbsConfigured,
      }
    })
  } catch (e: any) {
    console.error("Guest backups error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
