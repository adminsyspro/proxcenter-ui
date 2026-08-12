// Collecte des archives vzdump d'un guest sur les stockages PVE. Symétrique de
// pbsSnapshots.ts, qui fait le même travail pour les snapshots PBS. L'onglet
// Backups d'une VM fusionne les deux sources.

import { pveFetch } from "@/lib/proxmox/client"
import { mapWithConcurrency } from "@/lib/inventory/concurrency"
import { formatBytes } from "@/utils/format"

/**
 * Date encodée dans le nom de fichier d'une archive vzdump, par exemple
 * `local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst`.
 *
 * Repli utilisé uniquement quand `ctime` est absent de la réponse PVE, ce champ
 * étant optionnel au schéma. Proxmox écrit ce nom en heure locale du nœud ; on
 * l'interprète en UTC, donc le résultat peut dériver du décalage horaire. C'est
 * acceptable pour un repli dont le seul rôle est d'ordonner la liste.
 */
export function parseVzdumpVolidTime(volid: string): number | null {
  const m = /(\d{4})_(\d{2})_(\d{2})-(\d{2})_(\d{2})_(\d{2})/.exec(volid)

  if (!m) return null

  const ms = Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6]),
  )

  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/**
 * Type de guest porté par le volid, normalisé sur le vocabulaire PBS
 * (`vm` / `ct`) pour que les deux sources partagent le même champ.
 */
export function vzdumpBackupTypeFromVolid(volid: string): 'vm' | 'ct' | null {
  if (volid.includes('vzdump-qemu-')) return 'vm'
  if (volid.includes('vzdump-lxc-') || volid.includes('vzdump-openvz-')) return 'ct'

  return null
}

export interface VzdumpStorageConfig {
  storage: string
  type?: string
  content?: string
  shared?: number
}

export interface VzdumpScanTarget {
  node: string
  storage: string
}

/**
 * Plafond dur du nombre de paires nœud/stockage interrogées par requête. Le
 * produit nœuds en ligne x stockages de sauvegarde non partagés croît avec la
 * taille du cluster et l'onglet le réévalue à chaque ouverture.
 */
export const VZDUMP_MAX_PAIRS = 32

function supportsBackupContent(s: VzdumpStorageConfig): boolean {
  return (s.content || '')
    .split(',')
    .map(c => c.trim())
    .includes('backup')
}

/**
 * Paires nœud/stockage à interroger pour trouver les archives vzdump d'un guest.
 *
 * Les stockages PBS sont écartés : leurs snapshots remontent déjà par le fan-out
 * PBS, les inclure ici les compterait deux fois. Un stockage partagé n'est
 * interrogé qu'une fois ; un stockage local l'est sur chaque nœud en ligne,
 * parce qu'une archive reste sur le nœud qui l'a produite même après migration
 * du guest.
 */
export function resolveVzdumpScanTargets(
  storages: VzdumpStorageConfig[],
  resources: any[],
  currentNode?: string | null,
): { targets: VzdumpScanTarget[]; truncated: boolean } {
  const onlineNodes = new Set(
    (resources || [])
      .filter(r => r?.type === 'node' && r?.status === 'online')
      .map(r => String(r.node)),
  )

  const orderedNodes = (nodesForStorage: string[]) => {
    const online = nodesForStorage.filter(n => onlineNodes.has(n))

    if (currentNode && online.includes(currentNode)) {
      return [currentNode, ...online.filter(n => n !== currentNode)]
    }

    return online
  }

  const targets: VzdumpScanTarget[] = []

  for (const s of storages || []) {
    if (!s?.storage) continue
    if ((s.type || '').toLowerCase() === 'pbs') continue
    if (!supportsBackupContent(s)) continue

    const nodesForStorage = (resources || [])
      .filter(r => r?.type === 'storage' && r?.storage === s.storage)
      .map(r => String(r.node))

    const candidates = orderedNodes(Array.from(new Set(nodesForStorage)))

    if (candidates.length === 0) continue

    if (s.shared === 1) targets.push({ node: candidates[0], storage: s.storage })
    else for (const node of candidates) targets.push({ node, storage: s.storage })
  }

  if (currentNode) {
    targets.sort((a, b) => Number(b.node === currentNode) - Number(a.node === currentNode))
  }

  const truncated = targets.length > VZDUMP_MAX_PAIRS

  return { targets: truncated ? targets.slice(0, VZDUMP_MAX_PAIRS) : targets, truncated }
}

/** pveproxy a un pool de workers limité ; on reste bien sous le plafond
 *  d'inventaire pour ne pas affamer l'UI Proxmox du client. */
export const VZDUMP_SCAN_CONCURRENCY = 6

export interface VzdumpBackup {
  id: string
  source: 'vzdump'
  volid: string
  node: string
  storage: string
  backupType: 'vm' | 'ct'
  backupId: string
  backupTime: number
  backupTimeKnown: boolean
  backupTimeFormatted: string
  size: number
  sizeFormatted: string
  format: string
  protected: boolean
  comment: string
  verified: false
  verification: null
}

function normalizeVzdumpItem(
  item: any,
  node: string,
  storage: string,
  dateLocale: string,
): VzdumpBackup | null {
  const volid = String(item?.volid || '')

  if (!volid) return null

  const backupType = vzdumpBackupTypeFromVolid(volid)

  if (!backupType) return null

  // `ctime` est optionnel au schéma PVE : repli sur la date du nom de fichier,
  // puis date inconnue. Jamais de 0 silencieux qui fausserait le tri.
  const ctime = typeof item?.ctime === 'number' ? item.ctime : null
  const parsed = ctime ?? parseVzdumpVolidTime(volid)
  const backupTimeKnown = parsed !== null
  const backupTime = parsed ?? 0
  const size = typeof item?.size === 'number' ? item.size : 0

  return {
    id: `${node}/${volid}`,
    source: 'vzdump',
    volid,
    node,
    storage,
    backupType,
    backupId: String(item?.vmid ?? ''),
    backupTime,
    backupTimeKnown,
    backupTimeFormatted: backupTimeKnown
      ? new Date(backupTime * 1000).toLocaleString(dateLocale)
      : '-',
    size,
    sizeFormatted: formatBytes(size),
    format: String(item?.format || ''),
    protected: !!item?.protected,
    comment: String(item?.notes || ''),
    verified: false,
    verification: null,
  }
}

/**
 * Archives vzdump d'un guest, tous stockages PVE non-PBS du cluster confondus.
 *
 * `storages` est la configuration cluster-wide `/storage`, déjà récupérée par
 * l'appelant : la route en a besoin par ailleurs pour calculer `pbsConfigured`,
 * on ne la refetch pas ici.
 *
 * Ne lève jamais. Toute panne devient un warning, pour qu'un stockage
 * injoignable n'efface pas les archives trouvées ailleurs.
 */
export async function listGuestVzdumpBackups(
  conn: any,
  vmid: string,
  opts: {
    typeFilter?: string | null
    dateLocale: string
    storages: VzdumpStorageConfig[]
    currentNode?: string | null
  },
): Promise<{ data: VzdumpBackup[]; warnings: string[] }> {
  const warnings: string[] = []

  const backupStorages = (opts.storages || []).filter(
    s => s?.storage && (s.type || '').toLowerCase() !== 'pbs' && supportsBackupContent(s),
  )

  if (backupStorages.length === 0) return { data: [], warnings }

  let resources: any[] = []

  try {
    resources = await pveFetch<any[]>(conn, '/cluster/resources')
  } catch (e: any) {
    warnings.push(`cluster topology: ${e?.message || String(e)}`)

    return { data: [], warnings }
  }

  const { targets, truncated } = resolveVzdumpScanTargets(backupStorages, resources, opts.currentNode)

  if (truncated) {
    warnings.push(`vzdump scan truncated to ${VZDUMP_MAX_PAIRS} node/storage pairs`)
  }

  const perTarget = await mapWithConcurrency(
    targets,
    VZDUMP_SCAN_CONCURRENCY,
    async ({ node, storage }) => {
      const path =
        `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}` +
        `/content?content=backup&vmid=${encodeURIComponent(vmid)}`

      try {
        const items = await pveFetch<any[]>(conn, path)

        return (items || [])
          .map(item => normalizeVzdumpItem(item, node, storage, opts.dateLocale))
          .filter((b): b is VzdumpBackup => b !== null)
      } catch (e: any) {
        warnings.push(`${node}/${storage}: ${e?.message || String(e)}`)

        return []
      }
    },
  )

  const wanted = opts.typeFilter === 'vm' || opts.typeFilter === 'ct' ? opts.typeFilter : null
  const seen = new Set<string>()
  const data: VzdumpBackup[] = []

  for (const backup of perTarget.flat()) {
    if (wanted && backup.backupType !== wanted) continue
    if (seen.has(backup.volid)) continue
    seen.add(backup.volid)
    data.push(backup)
  }

  // Récent d'abord ; les entrées sans date connue ferment la marche.
  data.sort((a, b) => {
    if (a.backupTimeKnown !== b.backupTimeKnown) return a.backupTimeKnown ? -1 : 1

    return b.backupTime - a.backupTime
  })

  return { data, warnings }
}
