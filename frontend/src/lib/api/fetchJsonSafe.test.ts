import { describe, it, expect, vi } from 'vitest'

import { fetchJsonSafe } from './fetchJsonSafe'

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
