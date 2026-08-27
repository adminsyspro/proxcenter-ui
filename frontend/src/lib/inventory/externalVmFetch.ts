/**
 * Client-side budget and error wording for the external hypervisor VM
 * listings the inventory tree fetches (`/api/v1/<type>/<id>/vms`).
 *
 * VMware, XCP-ng and Nutanix answer one REST/SOAP call, so 15 s is plenty.
 * Hyper-V runs PowerShell over WinRM: powershell.exe start + Hyper-V module
 * import + Get-VM over every guest. A customer host with ~20 disks needed
 * 13 s for the cmdlets alone, and the old 15 s budget cut the request off
 * while the host was answering, showing it as "unreachable". The Hyper-V
 * budget sits above the WinRM client's cap for one command's output wait
 * (MAX_RECEIVE_WAIT_MS, 120 s, see lib/hyperv/winrm.ts) plus the shell round
 * trips, so the UI never gives up while the route is still legitimately
 * waiting. A dead host still fails fast: the first WinRM request times out
 * after 30 s.
 */

export const DEFAULT_EXTERNAL_VM_FETCH_TIMEOUT_MS = 15_000

const TIMEOUT_BY_TYPE: Record<string, number> = {
  hyperv: 150_000,
}

export function externalVmFetchTimeoutMs(type: string | undefined): number {
  return (type && TIMEOUT_BY_TYPE[type]) || DEFAULT_EXTERNAL_VM_FETCH_TIMEOUT_MS
}

/**
 * Wording for a failed listing. The routes put the real cause (WinRM fault,
 * PowerShell error, SOAP fault) in the `error` field of the body; surface it
 * instead of the bare HTTP status so the tooltip tells the user what to fix.
 */
export async function describeVmLoadFailure(res: Response): Promise<string> {
  let message: string | undefined
  try {
    const json = await res.json()
    if (typeof json?.error === 'string' && json.error.trim()) message = json.error.trim()
  } catch {
    // Non-JSON body (proxy page, empty 502): fall back to the status code
  }
  return message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`
}

export function describeVmLoadTimeout(timeoutMs: number): string {
  return `timeout after ${Math.round(timeoutMs / 1000)}s`
}
