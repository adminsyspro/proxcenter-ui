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
 * This helper (a) uses the correct URL and (b) reads the body defensively so
 * any future non-JSON response (an HTML error page from a reverse proxy, a
 * 404/502/504) surfaces a clean HTTP error instead of a JSON-parse exception.
 */
export interface RunBackupJobResult {
  ok: boolean
  error?: string
  data?: unknown
}

export async function runBackupJobNow(
  connectionId: string,
  jobId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunBackupJobResult> {
  const url = `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/${encodeURIComponent(jobId)}?action=run`
  const res = await fetchImpl(url, { method: 'POST' })

  const text = await res.text()
  let body: { error?: string; data?: unknown } | undefined

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Non-JSON body (HTML error page, wrong path). Don't let JSON.parse
      // leak its cryptic "Unexpected token '<'" message to the user.
      return { ok: false, error: `HTTP ${res.status}` }
    }
  }

  if (!res.ok || body?.error) {
    return { ok: false, error: body?.error || `HTTP ${res.status}` }
  }

  return { ok: true, data: body?.data }
}
