/**
 * Test harness for Next.js App Router route handlers.
 *
 * Use `callRoute(handler, { params, body, ... })` to invoke a POST/GET/etc.
 * handler the same way Next would, without spinning up a server. Returns
 * the NextResponse so tests can assert on status and body.
 *
 * Each test file remains responsible for `vi.mock`-ing the route's
 * dependencies (Prisma, RBAC, orchestrator fetch, etc.). The harness has
 * no opinion on what to stub.
 */

import { NextResponse } from 'next/server'

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

export interface CallRouteOptions {
  /** Route param values, e.g. { id: 'conn-1' }. Will be wrapped as a Promise (App Router contract). */
  params?: Record<string, string>
  /** Request body. Object values are JSON-stringified and Content-Type is set automatically. */
  body?: Json | FormData | undefined
  /** Query string entries. */
  searchParams?: Record<string, string>
  /** Additional request headers. */
  headers?: Record<string, string>
  /** HTTP method. Defaults to POST when body is provided, otherwise GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** URL path used to construct the Request. Default: 'http://test.local/_'. */
  url?: string
}

type RouteHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>

/**
 * Invoke a Next.js App Router handler with a synthetic Request + ctx.
 * Returns the response so the test can assert on status, headers, body.
 */
export async function callRoute(
  handler: RouteHandler,
  opts: CallRouteOptions = {},
): Promise<Response> {
  const {
    params = {},
    body,
    searchParams,
    headers: extraHeaders = {},
    method,
    url = 'http://test.local/_',
  } = opts

  const headers = new Headers(extraHeaders)
  let serialisedBody: BodyInit | undefined

  if (body !== undefined) {
    if (body instanceof FormData) {
      serialisedBody = body
    } else if (typeof body === 'string') {
      serialisedBody = body
      if (!headers.has('content-type')) headers.set('content-type', 'text/plain')
    } else {
      serialisedBody = JSON.stringify(body)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    }
  }

  const finalMethod = method ?? (body !== undefined ? 'POST' : 'GET')

  let finalUrl = url
  if (searchParams) {
    const u = new URL(url)
    for (const [k, v] of Object.entries(searchParams)) u.searchParams.set(k, v)
    finalUrl = u.toString()
  }

  const req = new Request(finalUrl, {
    method: finalMethod,
    headers,
    body: serialisedBody,
  })

  return handler(req, { params: Promise.resolve(params) })
}

/**
 * Convenience: parse a Response body as JSON. Returns `undefined` when
 * the response has no body (e.g. 204). Throws on non-JSON content.
 */
export async function readJson<T = unknown>(res: Response): Promise<T | undefined> {
  const text = await res.text()
  if (!text) return undefined
  return JSON.parse(text) as T
}

/**
 * Build a denied-permission response that matches what RBAC's
 * checkPermission returns when the user lacks the right. Tests that
 * mock checkPermission to return "denied" should return this shape.
 */
export function deniedPermissionResponse(reason = 'Permission denied'): Response {
  return NextResponse.json({ error: reason }, { status: 403 })
}
