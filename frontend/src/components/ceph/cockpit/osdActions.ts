import type { OkToStopPayload } from '@/lib/ceph/okToStop'
import { cephServiceUrl, postCephTask, type CephTaskResult } from '@/lib/ceph/serviceClient'
import type { CephOsd } from '@/lib/ceph/types'

/*
   Browser side of the OSD actions of the cockpit: the URLs, the POST of an action
   (in, out, scrub, deep-scrub on the OSD route; start, stop and restart on the service route
   the node Ceph tab already uses) and the ok-to-stop precheck. Every call goes to a PVE node
   (the CRUSH host resolved by resolvePveNode), never to the raw CRUSH host name. Nothing here renders.
*/

const enc = encodeURIComponent

export type OsdQuickAction = 'in' | 'out' | 'scrub' | 'deep-scrub'
export type OsdServiceAction = 'start' | 'stop' | 'restart'

export const cephOsdUrl = (conn: string, node: string, id: number) =>
  `/api/v1/connections/${enc(conn)}/nodes/${enc(node)}/ceph/osd/${id}`

export const cephOsdOkToStopUrl = (conn: string, node: string, id: number) => `${cephOsdUrl(conn, node, id)}/ok-to-stop`

/** in, out, scrub or deep-scrub; `force` only means something for out, where it skips the server's own ok-to-stop. */
export function postOsdAction(conn: string, node: string, osd: Pick<CephOsd, 'id'>, action: OsdQuickAction, force = false): Promise<CephTaskResult> {
  return postCephTask(cephOsdUrl(conn, node, osd.id), action === 'out' ? { action, force } : { action })
}

/** stop or restart of the OSD daemon, on the service route (which asks ok-to-stop itself unless forced). */
export function postOsdService(conn: string, node: string, osd: Pick<CephOsd, 'id'>, action: OsdServiceAction, force = false): Promise<CephTaskResult> {
  return postCephTask(cephServiceUrl(conn, node), { action, service: `osd.${osd.id}`, force })
}

const isPayload = (v: unknown): v is OkToStopPayload =>
  Boolean(v) && typeof v === 'object' && typeof (v as OkToStopPayload).ok === 'boolean'

/** The ok-to-stop verdict of an OSD; null when it could not be obtained (never throws, never invents a verdict). */
export async function fetchOkToStop(conn: string, node: string, osd: Pick<CephOsd, 'id'>, signal?: AbortSignal): Promise<OkToStopPayload | null> {
  try {
    const res = await fetch(cephOsdOkToStopUrl(conn, node, osd.id), { method: 'POST', signal })

    if (!res.ok) return null

    const json = await res.json().catch(() => null)

    if (!isPayload(json?.data)) return null

    return json.data
  } catch {
    return null
  }
}
