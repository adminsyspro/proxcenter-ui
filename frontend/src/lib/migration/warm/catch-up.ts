/**
 * The sync a warm migration runs between the operator's "Cutover" and the stop
 * of the source VM.
 *
 * The last delta is copied with the source stopped, so whatever changed since
 * the previous sync is downtime. With syncs an hour or a day apart that would
 * be an hour or a day of changes. One more sync while the VM still runs brings
 * the copy up to date first: only what changes during that sync is left for
 * the stopped source, whatever the interval was.
 *
 * It delays the stop of the source by the length of one sync and costs it one
 * more snapshot. A sync that fails here does not fail the migration: the
 * cutover goes on as it did before this step existed.
 */
import { appendLog, isCancelled } from "./job-control"

/** A sync that ended less than this long ago is recent enough: no catch-up. */
export const CATCH_UP_MIN_AGE_MS = 30_000

/**
 * Run the catch-up sync unless the last sync just ended. `runPass` runs one
 * delta pass and answers the bytes it copied. Answers the bytes copied, 0 when
 * skipped or failed; throws only on cancellation.
 */
export async function catchUpBeforeCutover(jobId: string, lastPassEndMs: number | undefined, runPass: () => Promise<number>): Promise<number> {
  if (lastPassEndMs !== undefined && Date.now() - lastPassEndMs < CATCH_UP_MIN_AGE_MS) return 0
  await appendLog(jobId, "Cutover: one more sync first, while the source VM still runs. Only what changes during this sync is left to copy once the source is stopped.", "info")
  const started = Date.now()
  try {
    const bytes = await runPass()
    await appendLog(jobId, `Catch-up sync: ${(bytes / 1048576).toFixed(1)} MB in ${Math.max(1, Math.round((Date.now() - started) / 1000))} s. Stopping the source now.`, "info")
    return bytes
  } catch (e: any) {
    if (isCancelled(jobId)) throw e
    await appendLog(jobId, `Catch-up sync failed (${e?.message || e}). Carrying on with the cutover: the changes since the last sync are copied with the source stopped, which lengthens the downtime.`, "warn")
    return 0
  }
}
