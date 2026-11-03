// src/lib/microseg/api.ts
//
// Browser client of the micro-segmentation API. Every call goes through the
// Next relay at /api/v1/firewall/microseg/{connectionId}/<route>.

import type {
  EmergencyStopResult, FlowInput, MembersInput, MicrosegDrift, MicrosegFlow, MicrosegPolicy,
  MicrosegRevision, MicrosegRun, MicrosegStatus, MicrosegSuggestion, MicrosegZone, PolicyUpdate,
  PreflightCheck, ResolveSuggestionsInput, SuggestionKind, SuggestionStatus, ZoneInput, ZoneState,
} from './types'

export class MicrosegApiError extends Error {
  readonly status: number
  readonly code: string
  readonly serverMessage?: string

  constructor(status: number, code: string, serverMessage?: string) {
    super(serverMessage || code)
    this.name = 'MicrosegApiError'
    this.status = status
    this.code = code
    this.serverMessage = serverMessage
  }
}

/** 409 VERSION_CONFLICT: the draft moved under the caller. */
export class MicrosegConflictError extends MicrosegApiError {
  constructor(serverMessage?: string) {
    super(409, 'VERSION_CONFLICT', serverMessage)
    this.name = 'MicrosegConflictError'
  }
}

/** The error codes that have their own message in the microsegPilot catalogue (the others read as generic). */
export const KNOWN_CODES: ReadonlySet<string> = new Set([
  'VERSION_CONFLICT', 'BUSY', 'ZONE_NAME_TAKEN', 'IN_USE', 'CONFLICT', 'INVALID', 'FEATURE_REQUIRED',
  'FORBIDDEN', 'NOT_FOUND', 'UNAUTHORIZED', 'NOT_LEADER', 'MICROSEG_UNAVAILABLE', 'ENGINE_STOPPED',
  'ORCHESTRATOR_ERROR', 'ORCHESTRATOR_TIMEOUT', 'PVE_ERROR', 'NETWORK',
])

/** i18n key of an error code (the strings live in the microsegPilot catalogue). */
export function microsegErrorKey(code: string | null | undefined): string {
  return code && KNOWN_CODES.has(code) ? `microsegPilot.errors.${code}` : 'microsegPilot.errors.generic'
}

/** The error key of anything a call may throw. */
export function microsegErrorKeyOf(error: unknown): string {
  return microsegErrorKey(error instanceof MicrosegApiError ? error.code : null)
}

function fallbackCode(status: number): string {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 413 || status === 400) return 'INVALID'
  if (status === 504) return 'ORCHESTRATOR_TIMEOUT'
  if (status === 502) return 'ORCHESTRATOR_ERROR'
  return 'INTERNAL'
}

async function parseBody(res: Response): Promise<any> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function toError(res: Response): Promise<MicrosegApiError> {
  const body = await parseBody(res)
  const code = typeof body?.code === 'string' && body.code ? body.code : fallbackCode(res.status)
  const message = typeof body?.error === 'string' ? body.error : undefined
  if (res.status === 409 && code === 'VERSION_CONFLICT') return new MicrosegConflictError(message)
  return new MicrosegApiError(res.status, code, message)
}

export type RunStarted = { run_id: string }

export type PageParams = { limit?: number; offset?: number }
export type ListRunsParams = PageParams
export type ListSuggestionsParams = PageParams & {
  kind?: SuggestionKind
  status?: SuggestionStatus
  zone?: string
}

function query(params: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return s ? `?${s}` : ''
}

export function microsegBaseUrl(connId: string): string {
  return `/api/v1/firewall/microseg/${encodeURIComponent(connId)}`
}

export type MicrosegApi = ReturnType<typeof microsegApi>

export function microsegApi(connId: string) {
  const base = microsegBaseUrl(connId)

  // Any 2xx is a success (200, and the 202 of the asynchronous runs).
  async function call<T>(method: string, route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const init: RequestInit = { method, cache: 'no-store', signal }
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    let res: Response
    try {
      res = await fetch(`${base}/${route}`, init)
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') throw e
      throw new MicrosegApiError(0, 'NETWORK', e instanceof Error ? e.message : undefined)
    }
    if (!res.ok) throw await toError(res)
    return (await parseBody(res)) as T
  }

  const id = encodeURIComponent

  return {
    getPolicy: (signal?: AbortSignal) => call<MicrosegPolicy>('GET', 'policy', undefined, signal),
    savePolicy: (body: PolicyUpdate) => call<{ version: number; policy: MicrosegPolicy['policy'] }>('PUT', 'policy', body),

    saveZone: ({ id: zoneId, ...body }: ZoneInput) =>
      call<{ version: number; zone: MicrosegZone }>(zoneId ? 'PUT' : 'POST', zoneId ? `zones/${id(zoneId)}` : 'zones', body),
    deleteZone: (zoneId: string, version: number) => call<{ version: number }>('DELETE', `zones/${id(zoneId)}`, { version }),
    setZoneState: (zoneId: string, state: ZoneState, version: number) =>
      call<RunStarted>('POST', `zones/${id(zoneId)}/state`, { version, state }),

    saveFlow: ({ id: flowId, ...body }: FlowInput) =>
      call<{ version: number; flow: MicrosegFlow }>(flowId ? 'PUT' : 'POST', flowId ? `flows/${id(flowId)}` : 'flows', body),
    deleteFlow: (flowId: string, version: number) => call<{ version: number }>('DELETE', `flows/${id(flowId)}`, { version }),

    setMembers: (body: MembersInput) => call<{ version: number }>('POST', 'members', body),

    startPlan: () => call<RunStarted>('POST', 'plan'),
    startApply: (version: number) => call<RunStarted>('POST', 'apply', { version }),
    startRemove: () => call<RunStarted>('POST', 'remove'),
    confirmWrites: () => call<{ ok: boolean; was_held: boolean }>('POST', 'confirm-writes'),
    /** The leader answers 200, a follower 202 (applied by the leader within a minute). */
    emergencyStop: (on: boolean) => call<EmergencyStopResult>('POST', 'emergency-stop', { on }),

    getRun: (runId: string, signal?: AbortSignal) => call<MicrosegRun>('GET', `runs/${id(runId)}`, undefined, signal),
    listRuns: (params: ListRunsParams = {}) =>
      call<{ runs: MicrosegRun[]; limit: number; offset: number }>('GET', `runs${query(params)}`),

    listRevisions: async (limit?: number) =>
      (await call<{ revisions: MicrosegRevision[] }>('GET', `revisions${query({ limit })}`)).revisions,
    restoreRevision: (revisionId: string, version: number) =>
      call<RunStarted>('POST', `revisions/${id(revisionId)}/restore`, { version }),

    listSuggestions: (params: ListSuggestionsParams = {}) =>
      call<{ suggestions: MicrosegSuggestion[]; limit: number; offset: number }>('GET', `suggestions${query(params)}`),
    resolveSuggestions: (body: ResolveSuggestionsInput) => call<{ version: number }>('POST', 'suggestions/resolve', body),

    getDrifts: async () => (await call<{ drifts: MicrosegDrift[] }>('GET', 'drifts')).drifts,
    getPreflight: async () => (await call<{ checks: PreflightCheck[] }>('GET', 'preflight')).checks,
    getStatus: (signal?: AbortSignal) => call<MicrosegStatus>('GET', 'status', undefined, signal),
  }
}

/**
 * A plan computed from an older draft than the current one must be recomputed (UA6).
 * The Go side omits a version of 0, so a plan without a version is the plan of
 * draft 0: stale as soon as the draft has a version.
 */
export function isPlanStale(run: Pick<MicrosegRun, 'result'> | null | undefined, draftVersion: number): boolean {
  const result = run?.result
  if (!result) return false
  if (typeof result.version === 'number') return result.version !== draftVersion
  return draftVersion > 0
}
