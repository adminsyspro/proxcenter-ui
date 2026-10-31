import { describe, it, expect, vi } from 'vitest'

import { ApiError, errorMessage, fetchJsonResult, fetchJsonSafe, jsonInit, requireOk, settleCounts } from './fetchJsonSafe'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchJsonSafe', () => {
  it('passes the url and init straight through to the fetch impl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: 1 }))

    await fetchJsonSafe('/api/x', { method: 'POST' }, fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]).toEqual(['/api/x', { method: 'POST' }])
  })

  it('returns ok with the data payload on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { jobs: [1, 2] } }))

    const result = await fetchJsonSafe('/api/x', undefined, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: true, data: { jobs: [1, 2] } })
  })

  it('returns ok with undefined data on an empty 2xx body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))

    const result = await fetchJsonSafe('/api/x', undefined, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: true, data: undefined })
  })

  it('surfaces a JSON error field from the backend', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'No node available' }, 400))

    const result = await fetchJsonSafe('/api/x', undefined, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, error: 'No node available' })
  })

  it('falls back to the status when a non-ok response carries no error field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500))

    const result = await fetchJsonSafe('/api/x', undefined, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, error: 'HTTP 500' })
  })

  it('does not leak "Unexpected token \'<\'" on an nginx HTML gateway page', async () => {
    // The exact regression from discussion #396: a reverse proxy returns its
    // own 504 page (a bare `<html><head>...`, no <!DOCTYPE) and the old code
    // did `await res.json()`, throwing `Unexpected token '<', "<html> <h"...`.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        '<html>\r\n<head><title>504 Gateway Time-out</title></head>\r\n<body>...</body>\r\n</html>',
        { status: 504, headers: { 'content-type': 'text/html' } },
      ),
    )

    const result = await fetchJsonSafe('/api/x', undefined, fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, error: 'HTTP 504' })
  })
})

const asFetch = (fn: unknown) => fn as typeof fetch

describe('fetchJsonResult', () => {
  it('keeps the status and the whole body of an unwrapped payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: 'a' }], 200))

    const result = await fetchJsonResult('/api/x', undefined, asFetch(fetchImpl))

    expect(result).toEqual({ ok: true, data: undefined, status: 200, body: [{ id: 'a' }] })
  })

  it('reads the message of an object error and of a bare message field', async () => {
    const objectError = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'locked' } }, 409))
    const messageOnly = vi.fn().mockResolvedValue(jsonResponse({ message: 'quota reached' }, 422))
    const emptyObjectError = vi.fn().mockResolvedValue(jsonResponse({ error: {} }, 500))

    expect((await fetchJsonResult('/x', undefined, asFetch(objectError))).error).toBe('locked')
    expect((await fetchJsonResult('/x', undefined, asFetch(messageOnly))).error).toBe('quota reached')
    expect((await fetchJsonResult('/x', undefined, asFetch(emptyObjectError))).error).toBe('HTTP 500')
  })

  it('reports the status of a non-JSON error page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }))

    expect(await fetchJsonResult('/x', undefined, asFetch(fetchImpl))).toEqual({ ok: false, error: 'HTTP 502', status: 502 })
  })
})

describe('requireOk', () => {
  it('resolves with the parsed body when the server accepted the call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'job-1' } }, 201))

    await expect(requireOk('/x', jsonInit('POST', { a: 1 }), asFetch(fetchImpl))).resolves.toEqual({ data: { id: 'job-1' } })
    expect(fetchImpl.mock.calls[0][1]).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' })
  })

  it('resolves with undefined on an empty 204', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))

    await expect(requireOk('/x', jsonInit('DELETE'), asFetch(fetchImpl))).resolves.toBeUndefined()
    expect(fetchImpl.mock.calls[0][1]).toEqual({ method: 'DELETE' })
  })

  it('throws an ApiError carrying the server message and status on a rejection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'Forbidden' }, 403))

    const err: ApiError = await requireOk('/x', undefined, asFetch(fetchImpl)).catch((e: ApiError) => e) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.message).toBe('Forbidden')
    expect(err.status).toBe(403)
  })

  it('propagates a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(requireOk('/x', undefined, asFetch(fetchImpl))).rejects.toThrow('Failed to fetch')
  })
})

describe('settleCounts', () => {
  it('counts every outcome without stopping at the first failure', async () => {
    const calls = [
      () => Promise.resolve(1),
      () => Promise.reject(new ApiError('refused', 500)),
      () => Promise.reject('plain reason'),
      () => Promise.resolve(2),
    ]

    expect(await settleCounts(calls)).toEqual({ succeeded: 2, failed: 2, firstError: 'refused' })
  })

  it('reports no error when everything succeeded', async () => {
    expect(await settleCounts([() => Promise.resolve()])).toEqual({ succeeded: 1, failed: 0 })
  })

  it('stringifies a non-Error rejection', async () => {
    expect(await settleCounts([() => Promise.reject('boom')])).toEqual({ succeeded: 0, failed: 1, firstError: 'boom' })
  })
})

describe('errorMessage', () => {
  it('reads an Error, a thrown string, else the fallback', () => {
    expect(errorMessage(new ApiError('refused', 403))).toBe('refused')
    expect(errorMessage('boom')).toBe('boom')
    expect(errorMessage({ reason: 'x' })).toBe('Unexpected error')
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback')
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
  })
})
