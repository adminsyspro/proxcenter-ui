import { requestWarmCutover } from "@/lib/migration/warm/warm-pipeline"

/**
 * Statuses a warm job can be cut over from. Warm-only: the cold, live and
 * virt-v2v pipelines never reach them, so the status alone gates the request.
 */
export const CUTOVER_ELIGIBLE: ReadonlySet<string> = new Set(["delta_sync", "awaiting_cutover"])

type JobWriter = { migrationJob: { update: (args: any) => Promise<unknown> } }

/**
 * Ask a waiting warm migration to cut over now, shared by the single route and
 * the batch one.
 *
 * The row is the signal: the pipeline mirrors it back into its own registry
 * (lib/migration/operator-signals). Writing it before the in-process call is
 * what makes the click survive a route handler that does not share the
 * pipeline's module instance, which is the normal case in dev and with more
 * than one frontend replica in production. `config`, when given, rides in the
 * same write: the pipeline reads it back from the row at cutover, and a retry
 * replays it.
 */
export async function requestJobCutover(prisma: JobWriter, jobId: string, config?: Record<string, unknown>): Promise<void> {
  await prisma.migrationJob.update({ where: { id: jobId }, data: { cutoverRequestedAt: new Date(), ...(config && { config }) } })
  requestWarmCutover(jobId)
}
