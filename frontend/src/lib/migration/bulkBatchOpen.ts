// Reopening the follow-up of a bulk migration from anywhere (roadmap#53).
//
// The follow-up dialog lives in the Inventory page, the taskbar on every page.
// The taskbar asks first through a DOM event: an Inventory page that is mounted
// claims it and opens the dialog in place. When nobody claims it, the taskbar
// navigates to the batch's source host with the batch id in the URL, and the
// Inventory page opens that batch once the host is selected.

export const OPEN_BULK_BATCH_EVENT = 'proxcenter:open-bulk-batch'

export interface OpenBulkBatchDetail {
  batchId: string
  sourceConnectionId: string
  /** Set by the listener that takes the request. */
  handled: boolean
}

/** Ask a mounted Inventory page to open the batch. True when one took it. */
export function requestOpenBulkBatch(batchId: string, sourceConnectionId: string): boolean {
  const detail: OpenBulkBatchDetail = { batchId, sourceConnectionId, handled: false }
  window.dispatchEvent(new CustomEvent<OpenBulkBatchDetail>(OPEN_BULK_BATCH_EVENT, { detail }))
  return detail.handled
}

/** The Inventory page on the batch's source host, opening the batch. */
export function bulkBatchInventoryUrl(batchId: string, sourceConnectionId: string): string {
  const q = new URLSearchParams({ selectType: 'ext', selectId: sourceConnectionId, openBatch: batchId })
  return `/infrastructure/inventory?${q.toString()}`
}

/** Logo of the source hypervisor of a batch (same set as the follow-up dialog). */
export function bulkBatchSourceLogo(sourceType: string | null | undefined): string {
  if (sourceType === 'hyperv') return '/images/hyperv-logo.svg'
  if (sourceType === 'nutanix') return '/images/nutanix-logo.svg'
  if (sourceType === 'xcpng') return '/images/xcpng-logo.svg'
  return '/images/esxi-logo.svg'
}
