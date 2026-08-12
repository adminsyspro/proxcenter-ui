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
