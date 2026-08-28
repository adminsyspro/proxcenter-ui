// src/lib/orchestrator/haProxy.ts
//
// Shared proxy for the /api/v1/ha/* routes. They all do the same thing:
// forward one call to the orchestrator and hand its JSON back untouched. What
// is worth centralising is the error path.
//
// Every one of these routes used to answer `503 Orchestrator unavailable` from
// a blind `catch`, including when the orchestrator was perfectly alive and had
// merely cut the response mid-flight once api.write_timeout expired. Operators
// then went hunting for a dead orchestrator that was in fact still working
// (#803: an HA preflight spanning three PVE clusters spends 3s per silently
// DROPped TCP probe and crossed the 30s server write deadline).

import { NextResponse } from 'next/server'

import { orchestratorHeaders } from './headers'

// Node/undici `cause.code` values meaning "the orchestrator was reached, then
// the exchange was cut or timed out". Measured on Node 26: a peer closing the
// socket mid-request surfaces as `TypeError: fetch failed` with
// `cause.code === 'UND_ERR_SOCKET'`, which is the SAME top-level message a
// refused connection produces (`cause.code === 'ECONNREFUSED'`). Only
// `cause.code` tells the two apart, which is why the old blind catch could
// not.
const CUT_SHORT_CODES = new Set([
  'UND_ERR_SOCKET', // other side closed, or reset
  'ECONNRESET',
  'UND_ERR_HEADERS_TIMEOUT', // undici caps at 300s; HA reinit polls Patroni up to 5min
  'UND_ERR_BODY_TIMEOUT',
])

export interface OrchestratorFailure {
  status: number
  error: string
}

/**
 * Classify a failed `fetch` toward the orchestrator. Anything that is not
 * provably a cut or a timeout keeps the historical
 * `503 Orchestrator unavailable`, so a genuinely down orchestrator still reads
 * the same way it always did.
 */
export function orchestratorFailure(cause: unknown): OrchestratorFailure {
  const err = cause as { name?: string; message?: string; cause?: { code?: string } } | null
  const code = err?.cause?.code

  if (err?.name === 'AbortError') {
    return { status: 504, error: 'Orchestrator request aborted before an answer came back' }
  }

  // `terminated` is what undici reports when the cut happens after the
  // response headers, mid-body.
  if ((code && CUT_SHORT_CODES.has(code)) || err?.message === 'terminated') {
    return {
      status: 504,
      error:
        'The orchestrator closed the connection before answering. The operation may still be running on the orchestrator, check its logs.',
    }
  }

  return { status: 503, error: 'Orchestrator unavailable' }
}

export function orchestratorBaseUrl(): string {
  return process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
}

export interface HaProxyOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Serialised as JSON. Omit entirely for the body-less operations, which
   *  must not carry a Content-Type either. */
  body?: unknown
}

/**
 * Forward one HA call to the orchestrator and return its response verbatim,
 * status included, so an upstream 400/409 payload reaches the wizard instead
 * of being flattened into a generic error.
 */
export async function proxyHaJson(path: string, opts: HaProxyOptions = {}): Promise<NextResponse> {
  const { method = 'GET', body } = opts

  let res: Response

  try {
    res = await fetch(`${orchestratorBaseUrl()}/api/v1${path}`, {
      method,
      headers:
        body === undefined
          ? orchestratorHeaders()
          : orchestratorHeaders({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (cause) {
    const failure = orchestratorFailure(cause)

    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }

  // The orchestrator answered. A body that is not JSON is a failure of its
  // own and must not be reported as an unreachable orchestrator either.
  try {
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json(
      { error: `Orchestrator returned a malformed response (HTTP ${res.status})` },
      { status: res.status >= 400 ? res.status : 502 }
    )
  }
}
