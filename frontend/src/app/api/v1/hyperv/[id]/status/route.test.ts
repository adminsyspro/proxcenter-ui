/**
 * Tests for GET /api/v1/hyperv/[id]/status: the WinRM host is derived from
 * the stored baseUrl (protocol, trailing slashes and port stripped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  ctor: vi.fn(),
  testConnection: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: vi.fn(() => 'LAB\\admin:s3cret') }))
vi.mock('@/lib/hyperv/log', () => ({ logHypervFailure: vi.fn((_w: string, _n: string, _h: string, e: any) => String(e?.message || e)) }))
vi.mock('@/lib/hyperv/client', () => ({
  HyperVClient: class {
    constructor(opts: any) { h.ctor(opts) }
    testConnection() { return h.testConnection() }
  },
}))

import { GET } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

function conn(baseUrl: string, insecureTLS = false) {
  return { id: 'c1', name: 'hv-lab', baseUrl, apiTokenEnc: 'enc', insecureTLS, type: 'hyperv' }
}

beforeEach(() => {
  h.ctor.mockReset()
  h.testConnection.mockReset().mockResolvedValue({ hostname: 'HV01', version: 'Windows Server 2022' })
})

describe('GET /api/v1/hyperv/[id]/status', () => {
  it.each([
    ['https://hv01.lab.local:5986/', 'hv01.lab.local', true],
    ['http://10.42.0.190///', '10.42.0.190', false],
    ['hv01.lab.local', 'hv01.lab.local', false],
  ])('derives the WinRM host from %s', async (baseUrl, host, useSSL) => {
    h.prisma.connection.findUnique.mockResolvedValue(conn(baseUrl))
    const res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(h.ctor).toHaveBeenCalledWith({ host, username: 'LAB\\admin', password: 's3cret', useSSL })
    expect((await readJson<any>(res)).data).toEqual({
      connected: true, status: 'online', type: 'hyperv', name: 'hv-lab', host: baseUrl, hostname: 'HV01', version: 'Windows Server 2022',
    })
  })
})
