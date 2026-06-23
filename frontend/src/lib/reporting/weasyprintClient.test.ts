// weasyprintClient.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('renderPdf', () => {
  const originalEnv = process.env.PROXCENTER_REPORTING_URL

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    process.env.PROXCENTER_REPORTING_URL = 'http://weasyprint:5000'
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PROXCENTER_REPORTING_URL
    } else {
      process.env.PROXCENTER_REPORTING_URL = originalEnv
    }
  })

  it('returns pdf bytes on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(true)
    expect(r.pdf?.length).toBe(3)
  })

  it('returns error on non-2xx with status in message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('500')
    expect(r.error).toContain('boom')
  })

  it('returns error when PROXCENTER_REPORTING_URL is not configured', async () => {
    delete process.env.PROXCENTER_REPORTING_URL
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not configured')
  })

  it('returns renderer timed out when fetch rejects with AbortError', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr))
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('renderer timed out')
  })

  it('returns the error message for non-abort fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')))
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('connection refused')
  })
})
