// src/lib/proxmox/guestConfigClient.ts
//
// Browser-side counterpart of the guest config route. That route answers 202
// with a task id when PVE has accepted the change but is still applying it: a
// memory unplug walks the DIMMs one at a time and sleeps 3s per module (#743),
// and a disk allocation on a thick-provisioned target is just as slow (#332).
// Both outlive the budget a request may hold, and neither is a failed save.
//
// Every browser-side guest config write goes through here so the task
// follow-up cannot be forgotten on a new call site.

import { waitForPveTask } from './waitForTaskClient'

export interface PutGuestConfigOptions {
  /** Called once when the write turned into a task we now have to follow. */
  onPending?: () => void
  /** Reported when PVE's task failed without saying why. */
  failedMessage?: string
  /** Reported when we stop following a task that is still running. */
  timeoutMessage?: string
}

/**
 * Write a sparse config patch to a guest and return once PVE has applied it.
 * Throws with a message fit for display when the write or the task fails.
 */
export async function putGuestConfig(
  connId: string,
  type: string,
  node: string,
  vmid: string,
  patch: Record<string, any>,
  options: PutGuestConfigOptions = {},
): Promise<void> {
  const res = await fetch(
    `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )

  const json: any = await res.json().catch(() => ({}))

  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

  // 200: PVE is done. 202: it handed us a task to keep following.
  if (!json?.pending || typeof json?.upid !== 'string' || typeof json?.node !== 'string') return

  options.onPending?.()

  const outcome = await waitForPveTask(connId, json.node, json.upid)

  if (outcome.outcome === 'failed') {
    throw new Error(outcome.error || options.failedMessage || 'Proxmox could not apply the change.')
  }

  if (outcome.outcome === 'timeout') {
    throw new Error(options.timeoutMessage || 'Proxmox is still applying this change.')
  }
}
