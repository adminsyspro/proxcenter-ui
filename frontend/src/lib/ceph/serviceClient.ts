/*
   Browser side of the Ceph service routes (ui#1164): the URLs, one POST
   helper that keeps the server's error, code and ok-to-stop verdict, and the
   disk candidates of the Create OSD dialog. Nothing here renders.
*/



export interface CephOkToStopView {
  ok: boolean
  osds?: number[]
  numOkPgs?: number
  numNotOkPgs?: number
  message?: string | null
}

export interface CephTaskResult {
  ok: boolean
  status: number
  upid?: string
  error?: string
  code?: string
  okToStop?: CephOkToStopView
}

const enc = encodeURIComponent

export const cephServiceUrl = (connId: string, host: string) =>
  `/api/v1/connections/${enc(connId)}/nodes/${enc(host)}/ceph/service`
export const cephCreateUrl = (connId: string, node: string) =>
  `/api/v1/connections/${enc(connId)}/nodes/${enc(node)}/ceph/create`

/** POST a JSON body and read the task answer; never throws. */
export async function postCephTask(url: string, body: Record<string, unknown>): Promise<CephTaskResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true, status: res.status, upid: json?.data?.upid }
    return { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}`, code: json?.code, okToStop: json?.okToStop }
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || "Network error" }
  }
}
