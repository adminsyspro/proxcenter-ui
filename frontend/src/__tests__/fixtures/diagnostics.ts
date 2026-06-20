// Static fixture for DiagnosticModal tests.
// Shape mirrors DiagResult / DiagCheck as defined in DiagnosticModal.tsx.

export interface DiagCheck {
  id: string
  category:
    | 'network'
    | 'auth'
    | 'version'
    | 'cluster'
    | 'storage'
    | 'ssh'
    | 'datastore'
  label: string
  status: 'ok' | 'warn' | 'error' | 'skip'
  message: string
  detail?: string
  durationMs: number
}

export interface DiagResult {
  connectionId: string
  type: string
  checks: DiagCheck[]
  summary: { ok: number; warn: number; error: number; skip: number }
  ranAt: string
  durationMs: number
}

// Two categories (network + auth), one ok check and one warn check.
export const diagResultFixture: DiagResult = {
  connectionId: 'conn-1',
  type: 'pve',
  checks: [
    {
      id: 'network-ping',
      category: 'network',
      label: 'Host reachable',
      status: 'ok',
      message: 'TCP connect succeeded',
      durationMs: 42,
    },
    {
      id: 'auth-token',
      category: 'auth',
      label: 'API token valid',
      status: 'warn',
      message: 'Token expires soon',
      detail: 'Expires in 3 days',
      durationMs: 88,
    },
  ],
  summary: { ok: 1, warn: 1, error: 0, skip: 0 },
  ranAt: '2026-06-20T00:00:00.000Z',
  durationMs: 130,
}
