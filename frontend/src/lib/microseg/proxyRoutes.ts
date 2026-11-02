// src/lib/microseg/proxyRoutes.ts
//
// The micro-segmentation routes the orchestrator serves under
// /api/v1/microseg/{connectionId}. The Next catch-all relays these and
// nothing else: an unknown path or verb answers 404 here, before the
// orchestrator is called. `write` decides the permission the caller needs
// (node.manage for a write, node.view for a read).

export type MicrosegRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Tested against the path segments after the connection id, joined with "/". */
  pattern: RegExp
  write: boolean
}

export const MICROSEG_ROUTES: MicrosegRoute[] = [
  { method: 'GET', pattern: /^policy$/, write: false },
  { method: 'PUT', pattern: /^policy$/, write: true },
  { method: 'POST', pattern: /^zones$/, write: true },
  { method: 'PUT', pattern: /^zones\/[^/]+$/, write: true },
  { method: 'DELETE', pattern: /^zones\/[^/]+$/, write: true },
  { method: 'POST', pattern: /^zones\/[^/]+\/state$/, write: true },
  { method: 'POST', pattern: /^flows$/, write: true },
  { method: 'PUT', pattern: /^flows\/[^/]+$/, write: true },
  { method: 'DELETE', pattern: /^flows\/[^/]+$/, write: true },
  { method: 'POST', pattern: /^members$/, write: true },
  { method: 'POST', pattern: /^plan$/, write: true },
  { method: 'POST', pattern: /^apply$/, write: true },
  { method: 'GET', pattern: /^revisions$/, write: false },
  { method: 'POST', pattern: /^revisions\/[^/]+\/restore$/, write: true },
  { method: 'GET', pattern: /^suggestions$/, write: false },
  { method: 'POST', pattern: /^suggestions\/resolve$/, write: true },
  { method: 'GET', pattern: /^drifts$/, write: false },
  { method: 'GET', pattern: /^preflight$/, write: false },
  { method: 'POST', pattern: /^confirm-writes$/, write: true },
  { method: 'POST', pattern: /^emergency-stop$/, write: true },
  { method: 'POST', pattern: /^remove$/, write: true },
  { method: 'GET', pattern: /^runs$/, write: false },
  { method: 'GET', pattern: /^runs\/[^/]+$/, write: false },
  { method: 'GET', pattern: /^status$/, write: false },
]

// Every segment is a plain identifier or a route word: no dot, no slash, no
// percent sign, so nothing can be re-interpreted on the way to the orchestrator.
const SEGMENT = /^[A-Za-z0-9_-]+$/

export function matchMicrosegRoute(method: string, path: string[]): MicrosegRoute | null {
  if (path.length === 0 || !path.every(segment => SEGMENT.test(segment))) return null

  const joined = path.join('/')

  return MICROSEG_ROUTES.find(route => route.method === method && route.pattern.test(joined)) ?? null
}
