/**
 * Bulk migration concurrency configuration shared between InventoryDialogs.tsx
 * (initial dispatch + UI logic) and InventoryDetails.tsx (queued-job poller
 * that starts new migrations as slots free up).
 *
 * Previously each file declared its own const which silently drifted out of
 * sync — InventoryDialogs.tsx was lowered to 1 (sequential) but InventoryDetails.tsx
 * stayed at 2, so the queued poller would still launch the second VM in
 * parallel right after the first one started. Centralising it here means
 * there's only one place to change.
 *
 * Default = 1 (sequential). Reasoning lives near the InventoryDialogs.tsx
 * import site (search "BULK_MIG_CONCURRENCY" comment) — short version: vCenter
 * NFC throughput and Proxmox node I/O contention make parallel runs slower
 * than sequential overall, and increase the risk of dd / qm-disk-import
 * timeouts under load.
 */
export const BULK_MIG_CONCURRENCY = 1
