// .../spice/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const pveFetchMock = vi.fn()
const getConnectionByIdMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  buildVmResourceId: (...a: string[]) => a.join('/'),
  PERMISSIONS: { VM_CONSOLE: 'vm.console' },
}))

import { POST, consumeSpiceSession } from './route'

function makeCtx(id: string, type: string, node: string, vmid: string) {
  return { params: Promise.resolve({ id, type, node, vmid }) }
}

const SPICE_CFG = {
  type: 'spice',
  host: 'proxyticket-abc',
  proxy: 'http://10.0.0.5:3128',
  'tls-port': 61000,
  password: 'SPICE-TICKET',
  ca: '-----BEGIN CERTIFICATE-----\\nMIIA\\n-----END CERTIFICATE-----\\n',
  'host-subject': 'CN=pve1',
}

beforeEach(() => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockReset()
  checkPermissionMock.mockReset()
  checkPermissionMock.mockResolvedValue(null)
})

describe('POST .../spice', () => {
  it('forwards an RBAC denial without calling Proxmox', async () => {
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'qemu', 'pve1', '100'))
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('rejects LXC with 400', async () => {
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'lxc', 'pve1', '100'))
    expect(res.status).toBe(400)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown connection', async () => {
    getConnectionByIdMock.mockResolvedValueOnce(null)
    const res = await POST(new Request('http://localhost'), makeCtx('x', 'qemu', 'pve1', '100'))
    expect(res.status).toBe(404)
  })

  it('returns 500 when spiceproxy throws', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ baseUrl: 'https://pve1:8006', apiToken: 't', insecureDev: false })
    pveFetchMock.mockRejectedValueOnce(new Error('no spice'))
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'qemu', 'pve1', '100'))
    expect(res.status).toBe(500)
  })

  it('returns sessionId + wsUrl + password, keeps proxyticket/ca server-side', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ baseUrl: 'https://pve1:8006', apiToken: 'tok', insecureDev: true })
    pveFetchMock.mockResolvedValueOnce(SPICE_CFG)
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'qemu', 'pve1', '100'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      sessionId: expect.any(String),
      wsUrl: expect.stringMatching(/^\/ws\/spice\//),
      password: 'SPICE-TICKET',
    })
    expect(body.data).not.toHaveProperty('proxyticket')
    expect(body.data).not.toHaveProperty('ca')
    expect(body.data).not.toHaveProperty('apiToken')

    const stored = consumeSpiceSession(body.data.sessionId)
    expect(stored).toMatchObject({
      proxyticket: 'proxyticket-abc',
      proxyHost: 'pve1', // connection host (https://pve1:8006), not the proxy node name
      proxyPort: 3128,
      tlsPort: 61000,
      hostSubject: 'CN=pve1',
      insecure: true,
    })
    expect(stored.ca).toContain('\n')
  })
})
