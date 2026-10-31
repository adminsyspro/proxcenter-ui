// Power action on a set of guests (start-all / shutdown-all from the node menu
// of the inventory tree). Each guest is one POST, five at a time, the cadence
// of the host view's bulk action (useVmActions); a refused or failed POST is
// counted, so the caller can say how many guests actually received the order.
import { requireOk } from '@/lib/api/fetchJsonSafe'
import { runInBatches } from '@/lib/migration/guestMigrateClient'

export interface BulkPowerGuest {
  connId: string
  node: string
  type: string
  vmid: string | number
}

export interface BulkPowerOutcome {
  success: number
  errors: number
  /** First refusal message, shown next to the counts. */
  firstError?: string
}

export const BULK_POWER_BATCH_SIZE = 5

export function guestPowerUrl(guest: BulkPowerGuest, action: string): string {
  return `/api/v1/connections/${encodeURIComponent(guest.connId)}/guests/${guest.type}/${encodeURIComponent(guest.node)}/${encodeURIComponent(guest.vmid)}/${action}`
}

export async function runBulkGuestPower(
  guests: ReadonlyArray<BulkPowerGuest>,
  action: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BulkPowerOutcome> {
  const results = await runInBatches(guests, BULK_POWER_BATCH_SIZE, async guest => {
    try {
      await requireOk(guestPowerUrl(guest, action), { method: 'POST' }, fetchImpl)

      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })
  const failures = results.filter((r): r is string => r !== null)

  return {
    success: results.length - failures.length,
    errors: failures.length,
    ...(failures.length > 0 ? { firstError: failures[0] } : {}),
  }
}

export type BulkPowerSeverity = 'success' | 'warning' | 'error'

/** success: all went through, warning: some did, error: none did. */
export function bulkPowerSeverity(outcome: BulkPowerOutcome): BulkPowerSeverity {
  if (outcome.errors === 0) return 'success'

  return outcome.success > 0 ? 'warning' : 'error'
}
