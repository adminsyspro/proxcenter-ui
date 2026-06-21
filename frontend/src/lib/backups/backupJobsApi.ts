/**
 * Client-side calls for the cluster Backups tab (BackupJobsPanel).
 *
 * Every call goes through {@link fetchJsonSafe} so a gateway error from a
 * reverse proxy (an HTML 502/504 page) surfaces as a clean `HTTP <status>`
 * instead of the cryptic `Unexpected token '<'` JSON-parse exception that was
 * reported on discussion #396. Each function takes an injectable `fetchImpl`
 * so it can be unit-tested without a DOM.
 */
import { fetchJsonSafe, type JsonResult } from "@/lib/api/fetchJsonSafe"

const base = (connectionId: string) =>
  `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs`

const jobUrl = (connectionId: string, jobId: string) =>
  `${base(connectionId)}/${encodeURIComponent(jobId)}`

export interface BackupJobsPayload {
  jobs?: unknown[]
  storages?: unknown[]
  nodes?: unknown[]
}

/** Load the backup jobs, storages and nodes for a connection. */
export function loadBackupJobs(
  connectionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResult<BackupJobsPayload>> {
  return fetchJsonSafe<BackupJobsPayload>(base(connectionId), undefined, fetchImpl)
}

/** Load the VMs/LXCs of a connection (used to populate the job's selection). */
export function loadBackupVms(
  connectionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResult<unknown[]>> {
  return fetchJsonSafe<unknown[]>(
    `/api/v1/connections/${encodeURIComponent(connectionId)}/resources?type=vm`,
    undefined,
    fetchImpl,
  )
}

/** Create (POST) or update (PUT) a backup job. */
export function saveBackupJob(
  connectionId: string,
  mode: "create" | "edit",
  jobId: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResult> {
  const url = mode === "create" ? base(connectionId) : jobUrl(connectionId, jobId)
  return fetchJsonSafe(
    url,
    {
      method: mode === "create" ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl,
  )
}

/** Delete a backup job. */
export function deleteBackupJob(
  connectionId: string,
  jobId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResult> {
  return fetchJsonSafe(jobUrl(connectionId, jobId), { method: "DELETE" }, fetchImpl)
}

/** Enable/disable a backup job. */
export function toggleBackupJob(
  connectionId: string,
  jobId: string,
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResult> {
  return fetchJsonSafe(
    jobUrl(connectionId, jobId),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
    fetchImpl,
  )
}
