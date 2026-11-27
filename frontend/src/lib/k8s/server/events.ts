import { CoreV1Api } from '@kubernetes/client-node'
import type { EventItem, K8sErrorCode } from '../types'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'

const MAX_EVENT_ITEMS = 200
const MAX_EVENT_MSG = 2000

export interface RawK8sEvent {
  type?: string
  reason?: string
  message?: string
  count?: number
  firstTimestamp?: Date
  lastTimestamp?: Date
  involvedObject: { kind?: string; name?: string; uid?: string }
}

function rfc3339(d: Date | undefined): string {
  if (!d) return ''
  if (isNaN(d.getTime()) || d.getTime() === 0) return ''
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function projectEvent(e: RawK8sEvent): EventItem {
  let msg = e.message ?? ''
  if (msg.length > MAX_EVENT_MSG) msg = msg.slice(0, MAX_EVENT_MSG)
  return {
    type: e.type ?? '',
    reason: e.reason ?? '',
    message: msg,
    object: `${e.involvedObject.kind ?? ''}/${e.involvedObject.name ?? ''}`,
    count: e.count ?? 0,
    firstSeen: rfc3339(e.firstTimestamp),
    lastSeen: rfc3339(e.lastTimestamp),
  }
}

// FetchFn is injected for unit tests; production path uses the real CoreV1Api.
export type EventFetchFn = (fieldSelector?: string) => Promise<RawK8sEvent[]>

export async function listEvents(
  input: BuildKubeClientInput,
  opts: { namespace?: string; involvedUid?: string; involvedName?: string },
  _fetchFn?: EventFetchFn,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: { items: EventItem[] } }> {
  let fieldSelector: string | undefined
  if (opts.involvedUid) {
    fieldSelector = `involvedObject.uid=${opts.involvedUid}`
  } else if (opts.involvedName) {
    fieldSelector = `involvedObject.name=${opts.involvedName}`
  }

  let rawItems: RawK8sEvent[]

  if (_fetchFn) {
    try {
      rawItems = await _fetchFn(fieldSelector)
    } catch (err) {
      return { ok: false, errorCode: classifyK8sError(err) }
    }
  } else {
    const built = buildKubeClient(input)
    if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
    const api = built.makeApiClient(CoreV1Api)
    try {
      const ns = opts.namespace
      const list = ns
        ? await api.listNamespacedEvent({ namespace: ns, fieldSelector })
        : await api.listEventForAllNamespaces({ fieldSelector })
      rawItems = list.items as RawK8sEvent[]
    } catch (err) {
      return { ok: false, errorCode: classifyK8sError(err) }
    }
  }

  rawItems.sort((a, b) => {
    const ta = a.lastTimestamp?.getTime() ?? 0
    const tb = b.lastTimestamp?.getTime() ?? 0
    return tb - ta
  })

  if (rawItems.length > MAX_EVENT_ITEMS) {
    rawItems = rawItems.slice(0, MAX_EVENT_ITEMS)
  }

  const items = rawItems.map(projectEvent)
  return { ok: true, value: { items } }
}
