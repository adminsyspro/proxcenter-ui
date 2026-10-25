import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same TDZ reasoning as route.test.ts: the mocks must be created through
// vi.hoisted because vi.mock's factories run before this file's own
// top-level `const` bindings are initialised.
const { guard, store, bootstrap, auditLib } = vi.hoisted(() => ({
  guard: { requireTlsAdmin: vi.fn() },
  store: { saveCertificate: vi.fn() },
  bootstrap: { applyActiveCertificate: vi.fn() },
  auditLib: { audit: vi.fn() },
}))

vi.mock('@/lib/tls/guard', () => guard)
vi.mock('@/lib/tls/store', () => store)
vi.mock('@/lib/tls/bootstrap', () => bootstrap)
vi.mock('@/lib/audit', () => auditLib)

import { PemError } from '@/lib/tls/pem'
import { POST } from '@/app/api/v1/settings/tls/upload/route'

beforeEach(() => {
  vi.clearAllMocks()
  guard.requireTlsAdmin.mockResolvedValue({ denied: null, userId: 'u1', userEmail: 'a@b.c' })
})

function post(body: unknown) {
  return POST(new Request('http://pc.lab/x', { method: 'POST', body: JSON.stringify(body) }))
}

describe('POST /api/v1/settings/tls/upload', () => {
  it('turns a PemError into a 400 carrying its code, so the form can point at the right field', async () => {
    store.saveCertificate.mockRejectedValue(new PemError('key_mismatch', 'nope'))

    const res = await post({ certPem: 'c', keyPem: 'k' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'key_mismatch' })
  })

  it('activates the imported certificate and reloads the listener', async () => {
    store.saveCertificate.mockResolvedValue({ id: 'c1', commonName: 'pc.lab', sanNames: [], fingerprint: 'AA', notAfter: new Date() })

    const res = await post({ certPem: 'c', keyPem: 'k', chainPem: null })

    expect(res.status).toBe(200)
    expect(store.saveCertificate).toHaveBeenCalledWith(expect.objectContaining({ source: 'uploaded', activate: true }))
    expect(bootstrap.applyActiveCertificate).toHaveBeenCalled()
  })

  it('never echoes the private key back', async () => {
    store.saveCertificate.mockResolvedValue({ id: 'c1', commonName: 'pc.lab', sanNames: [], fingerprint: 'AA', notAfter: new Date() })

    const body = await (await post({ certPem: 'c', keyPem: 'PRIVATE-KEY-MATERIAL' })).text()

    expect(body).not.toContain('PRIVATE-KEY-MATERIAL')
  })
})
