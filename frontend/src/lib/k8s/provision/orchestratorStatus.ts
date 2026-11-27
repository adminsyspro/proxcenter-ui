// src/lib/k8s/provision/orchestratorStatus.ts
// What a provisioning route answers when the orchestrator refused or failed a
// call. orchestratorFetch throws "Orchestrator <status>: <body>"; the body of a
// provisioning refusal is { error, code }. The route passes on the status and
// the code, never the raw text: a code is what the UI translates, and the
// text of a server fault is not for the caller.

const PASSED_THROUGH = new Set([400, 403, 404, 409, 422])

/** Codes the orchestrator's provisioning routes answer with (internal/api/provisioning.go). */
export type ProvisionErrorCode =
  | 'invalid_request'
  | 'connection_busy'
  | 'cluster_name_active'
  | 'ssh_access_required'
  | 'CONNECTION_LICENSE_EXCLUDED'
  | 'run_not_changeable'
  | 'workers_not_changeable'
  | 'not_found'
  | 'conflict'
  | 'unavailable'

const KNOWN_CODES = new Set<string>([
  'invalid_request', 'connection_busy', 'cluster_name_active', 'ssh_access_required', 'CONNECTION_LICENSE_EXCLUDED',
  'run_not_changeable', 'workers_not_changeable',
])

export interface OrchestratorFailure {
  status: number
  code: ProvisionErrorCode
  /** The orchestrator's sentence, kept only for a request the caller can correct (validation). */
  message?: string
}

export function orchestratorStatus(error: string | undefined): number {
  const m = typeof error === 'string' ? /^Orchestrator (\d{3})/.exec(error) : null
  const status = m ? Number(m[1]) : 0
  return PASSED_THROUGH.has(status) ? status : 502
}

function codeForStatus(status: number): ProvisionErrorCode {
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'

  return 'invalid_request'
}

export function orchestratorFailure(error: string | undefined): OrchestratorFailure {
  const status = orchestratorStatus(error)
  if (status === 502) return { status, code: 'unavailable' }

  let body: { error?: unknown; code?: unknown } = {}
  try {
    body = JSON.parse((error as string).replace(/^Orchestrator \d{3}:\s*/, ''))
  } catch {
    // Not JSON: only the status is known.
  }
  const code: ProvisionErrorCode = typeof body.code === 'string' && KNOWN_CODES.has(body.code)
    ? (body.code as ProvisionErrorCode)
    : codeForStatus(status)
  const message = code === 'invalid_request' && typeof body.error === 'string' ? body.error : undefined
  return { status, code, message }
}

/** The JSON body a provisioning route answers a failed orchestrator call with. */
export function failureBody(f: OrchestratorFailure): { error: ProvisionErrorCode; message?: string } {
  return f.message ? { error: f.code, message: f.message } : { error: f.code }
}
