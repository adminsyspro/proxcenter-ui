// weasyprintClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('renderPdf', () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); process.env.PROXCENTER_REPORTING_URL = 'http://weasyprint:5000' })
  it('returns pdf bytes on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })))
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(true); expect(r.pdf?.length).toBe(3)
  })
  it('returns error on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const { renderPdf } = await import('./weasyprintClient')
    const r = await renderPdf('<p>x</p>')
    expect(r.ok).toBe(false); expect(r.error).toContain('500')
  })
  it('returns error when env unset', async () => {
    delete process.env.PROXCENTER_REPORTING_URL
    const { renderPdf } = await import('./weasyprintClient')
    expect((await renderPdf('<p>x</p>')).ok).toBe(false)
  })
})
