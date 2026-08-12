// Collecte des archives vzdump d'un guest sur les stockages PVE. Symétrique de
// pbsSnapshots.ts, qui fait le même travail pour les snapshots PBS. L'onglet
// Backups d'une VM fusionne les deux sources.

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
