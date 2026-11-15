/**
 * Locks of the migration limits (ui#1332), shared by everything that counts
 * the running migrations before letting one more run: the batch scheduler
 * (lib/migration/batch-scheduler) and a warm job taking its place back before
 * a delta pass of a manual hold (lib/migration/warm/hold-slot).
 */

type LockTx = { $executeRaw: (query: TemplateStringsArray, ...values: any[]) => Promise<unknown> }

export const targetLimitScope = (targetConnectionId: string) => `migration-target:${targetConnectionId}`
export const sourceLimitScope = (sourceConnectionId: string) => `migration-source:${sourceConnectionId}`

/**
 * Transaction-scoped advisory lock on one limit scope (a target cluster or a
 * source connection): two counters sharing it run their counting and claiming
 * one after the other. Always taken in the same order, target then source, so
 * two of them never wait on each other. Advisory locks live outside any
 * schema, so the client's schema binding does not matter here.
 */
export async function lockLimitScope(tx: LockTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
}
