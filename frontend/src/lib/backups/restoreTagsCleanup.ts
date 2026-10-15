import { pveFetch } from '@/lib/proxmox/client'
import { isVmConfigNotFoundError } from '@/lib/proxmox/locateVm'
import { safeLog } from '@/lib/log/sanitize'
import { parseGuestTags } from '@/lib/backups/restoreTags'

// Server side of the "Restore tags" option (#965), run once the restore task
// is over.
//
// The empty `tags` override the route sends makes PVE write a blank `tags:`
// line: no tag, so nothing selects the guest, but it still shows up as an
// empty tag in listings. This removes the line. It also covers a PVE that
// kept real tags despite the override (none does today): they are removed
// here too and the case is logged, and the dialogs re-read the config before
// reporting success.

export type RestoredTagsCleanup = 'absent' | 'cleared' | 'missing' | 'locked' | 'failed'

export async function clearRestoredTags(args: {
  conn: Parameters<typeof pveFetch>[0]
  node: string
  isLxc: boolean
  vmid: number
}): Promise<RestoredTagsCleanup> {
  const { conn, node, isLxc, vmid } = args
  const configPath = `/nodes/${encodeURIComponent(node)}/${isLxc ? 'lxc' : 'qemu'}/${encodeURIComponent(String(vmid))}/config`
  const tag = `[restore-tags] vmid=${safeLog(vmid)}`

  let config: any
  try {
    config = await pveFetch<any>(conn, configPath)
  } catch (err: any) {
    // The restore failed before PVE wrote a config: nothing to clean.
    if (isVmConfigNotFoundError(err)) return 'missing'
    console.error(`${tag} could not read the restored config: ${safeLog(err?.message ?? err)}`)
    return 'failed'
  }

  if (!config || config.tags === undefined || config.tags === null) return 'absent'
  // Still being restored (task timed out on our side): PVE refuses the edit.
  if (config.lock) return 'locked'

  const kept = parseGuestTags(config.tags)
  if (kept.length > 0) {
    console.error(`${tag} PVE kept the backed-up tags despite the override, removing them: ${safeLog(kept.join(';'))}`)
  }

  try {
    await pveFetch(conn, configPath, {
      method: 'PUT',
      body: new URLSearchParams({ delete: 'tags' }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    } as any)
    return 'cleared'
  } catch (err: any) {
    console.error(`${tag} could not remove the tags line: ${safeLog(err?.message ?? err)}`)
    return 'failed'
  }
}
