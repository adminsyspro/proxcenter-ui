/**
 * Interpret a connection probe response for the status chip of the
 * Settings > Connections tables.
 *
 * The external hypervisor status routes (`/api/v1/{vmware,xcpng,nutanix,hyperv}/[id]/status`)
 * answer HTTP 200 with `data.status = 'auth_error'` when the host is reachable
 * but rejects the credentials. Judging on `res.ok` alone painted those green,
 * so a Hyper-V connection whose password was wrong showed "Online" in Settings
 * while the inventory tree said "unreachable".
 */

export type ConnectionStatusResult =
  | { status: 'ok' }
  | { status: 'error'; error: string }

export function interpretConnectionStatusResponse(
  res: { ok: boolean; status: number },
  json: any,
): ConnectionStatusResult {
  if (!res.ok) {
    const error = typeof json?.error === 'string' && json.error.trim() ? json.error.trim() : `HTTP ${res.status}`
    return { status: 'error', error }
  }

  if (json?.data?.status === 'auth_error') {
    const warning = typeof json.data.warning === 'string' && json.data.warning.trim()
    return { status: 'error', error: warning || 'Invalid credentials' }
  }

  return { status: 'ok' }
}
