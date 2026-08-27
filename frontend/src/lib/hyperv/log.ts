/**
 * Server-side trace for Hyper-V calls that fail. The UI only shows a status
 * chip or a tooltip, so the WinRM fault has to land in the server log for an
 * "unreachable" report to be diagnosable from `docker compose logs`.
 */

/** Logs the failure and returns its message, for callers that inspect it. */
export function logHypervFailure(what: string, connName: string, host: string, err: unknown): string {
  const msg = (err as any)?.message || String(err)
  console.error(`[hyperv] ${what} failed for ${connName} (${host}): ${msg}`)
  return msg
}

/** Runs a Hyper-V call, logging any failure before rethrowing it untouched. */
export async function withHypervLog<T>(what: string, connName: string, host: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    logHypervFailure(what, connName, host, err)
    throw err
  }
}
