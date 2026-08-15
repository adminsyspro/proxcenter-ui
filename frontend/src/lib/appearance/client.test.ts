import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPEARANCE_ENDPOINT, saveAppearance } from './client'

describe('saveAppearance', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs the settings as JSON to the appearance endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    const saved = await saveAppearance({ primaryColor: '#FFD200', mode: 'dark' })

    expect(saved).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe(APPEARANCE_ENDPOINT)
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ primaryColor: '#FFD200', mode: 'dark' })
  })

  it('does not ask to outlive the page by default', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    await saveAppearance({ mode: 'light' })

    expect(fetchMock.mock.calls[0][1].keepalive).toBe(false)
  })

  it('sets keepalive so a flush at page-hide time still reaches the server', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    await saveAppearance({ mode: 'light' }, { keepalive: true })

    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true)
  })

  it('reports a refused save without throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })

    await expect(saveAppearance({ mode: 'dark' })).resolves.toBe(false)
  })

  it('swallows a network failure: the colour is already applied locally', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    await expect(saveAppearance({ mode: 'dark' })).resolves.toBe(false)
  })
})
