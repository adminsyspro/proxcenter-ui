import { describe, it, expect, vi } from 'vitest'

import { runBackupJobNow } from './runBackupJob'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('runBackupJobNow', () => {
  it('posts to the query-param run action, not a /run path segment', async () => {
    // Regression for issue #397 / discussion #396: the UI used to POST to a
    // `/run` PATH segment, which has no route file. The handler reads the
    // action from the query string instead.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { upid: 'UPID:x' }, message: 'started' }))

    await runBackupJobNow('conn 1', 'backup-7', fetchImpl as unknown as typeof fetch)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/v1/connections/conn%201/backup-jobs/backup-7?action=run')
    expect(init).toMatchObject({ method: 'POST' })
  })

  it('returns ok with the data payload on success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { upid: 'UPID:x' }, message: 'started' }))

    const result = await runBackupJobNow('c', 'j', fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: true, data: { upid: 'UPID:x' } })
  })

  it('surfaces a JSON error field from the backend', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'No node available' }, 400))

    const result = await runBackupJobNow('c', 'j', fetchImpl as unknown as typeof fetch)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('No node available')
  })

  it('does not throw on an HTML (non-JSON) response, returns a clean HTTP error', async () => {
    // The original bug: a 404 HTML page made `res.json()` throw
    // `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>404</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const result = await runBackupJobNow('c', 'j', fetchImpl as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, error: 'HTTP 404' })
  })
})
