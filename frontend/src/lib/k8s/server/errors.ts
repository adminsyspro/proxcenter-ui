export type { K8sErrorCode } from '../types'
import type { K8sErrorCode } from '../types'

export function classifyK8sError(err: unknown): K8sErrorCode {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } }
  // ApiException (1.x) uses .code; 0.x used .statusCode; keep both as fallbacks
  const status = e?.code ?? e?.statusCode ?? e?.response?.statusCode
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  return 'unreachable'
}
