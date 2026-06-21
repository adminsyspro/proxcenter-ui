/**
 * Trigger an immediate run of a scheduled backup job ("Run now").
 *
 * The per-job route exposes the run action via the QUERY STRING
 * (`POST .../backup-jobs/{jobId}?action=run`, read with
 * `searchParams.get('action')`). The UI used to POST to a `/run` PATH
 * segment, which has no route file, so the request hit Next.js's HTML 404
 * page and `res.json()` threw the cryptic
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
 * (issue #397, discussion #396).
 *
 * The defensive body parsing now lives in {@link fetchJsonSafe}, shared with
 * the rest of the backup panel so any non-JSON response (an HTML error page
 * from a reverse proxy, a 404/502/504) surfaces a clean HTTP error instead of
 * a JSON-parse exception.
 */
import { fetchJsonSafe, type JsonResult } from "@/lib/api/fetchJsonSafe"

export type RunBackupJobResult = JsonResult

export async function runBackupJobNow(
  connectionId: string,
  jobId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunBackupJobResult> {
  const url = `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/${encodeURIComponent(jobId)}?action=run`
  return fetchJsonSafe(url, { method: "POST" }, fetchImpl)
}
