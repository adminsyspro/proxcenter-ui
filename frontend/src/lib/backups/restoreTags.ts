// "Restore tags" option of every restore path (#965).
//
// Tags are not cosmetic here: a tag-based Site Recovery job picks up any
// guest carrying one of its tags on its next run, DRS turns pxc_* tags into
// affinity rules, backup coverage honours its exclusion tag, and the
// proxcenter-replica marker keeps a guest out of Auto-HA. Restoring a backup
// with its tags drops the restored guest straight into all of that.
//
// When the user turns the option off, the restore route hands PVE an empty
// `tags` override, so the config PVE writes at the end of the restore (before
// it starts the guest, and before a live restore boots it) already carries no
// tag: there is no window where the guest is tagged. The check below is the
// safety net the UI runs once the task is over, so it never reports a clean
// restore while tags are still on the guest.
//
// Client-safe on purpose: imported by the restore dialogs.

/** The guest's real tags. PVE separates them with `;`, `,` or spaces, and an
 *  empty override leaves a blank `tags:` line that holds no tag at all. */
export function parseGuestTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw.split(/[;,\s]+/).map(tag => tag.trim()).filter(Boolean)
}

export type RestoredTagsCheck =
  | { status: 'clean' }
  | { status: 'kept'; tags: string[] }
  | { status: 'unknown'; error: string }

interface CheckArgs {
  connectionId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number | string
  /** Reads before giving up. The route clears the blank `tags:` line right
   *  after the task, so a read racing it is retried rather than reported. */
  attempts?: number
  delayMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Read the restored guest's config and tell whether it still carries tags. */
export async function checkRestoredTagsOmitted({
  connectionId,
  node,
  type,
  vmid,
  attempts = 3,
  delayMs = 2_000,
  fetchImpl = fetch,
  sleep = defaultSleep,
}: CheckArgs): Promise<RestoredTagsCheck> {
  const url = `/api/v1/connections/${encodeURIComponent(connectionId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(String(vmid))}/config`
  let last: RestoredTagsCheck = { status: 'unknown', error: 'not checked' }

  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    if (attempt > 0) await sleep(delayMs)
    try {
      const res = await fetchImpl(url, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        last = { status: 'unknown', error: json?.error || `HTTP ${res.status}` }
        continue
      }
      const tags = parseGuestTags(json?.data?.tags)
      if (tags.length === 0) return { status: 'clean' }
      last = { status: 'kept', tags }
    } catch (e: any) {
      last = { status: 'unknown', error: e?.message || String(e) }
    }
  }

  return last
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** What the UI reports for a check: nothing when clean, an error otherwise. */
export function restoredTagsCheckMessage(check: RestoredTagsCheck, t: Translate): string | null {
  if (check.status === 'clean') return null
  if (check.status === 'kept') return t('inventory.pbsRestoreTagsKept', { tags: check.tags.join(', ') })
  return t('inventory.pbsRestoreTagsUnverified', { error: check.error })
}
