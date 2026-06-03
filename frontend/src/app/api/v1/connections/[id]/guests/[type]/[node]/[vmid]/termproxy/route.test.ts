// .../termproxy/route.test.ts
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

import { POST } from './route'
import { takeSingleUse } from '@/lib/console/session'

function makeCtx(id: string, type: string, node: string, vmid: string) {
  return { params: Promise.resolve({ id, type, node, vmid }) }
}

beforeEach(() => {
  pveFetchMock.mockReset(); getConnectionByIdMock.mockReset(); checkPermissionMock.mockReset()
  checkPermissionMock.mockResolvedValue(null)
})

describe('POST .../termproxy', () => {
  it('forwards RBAC denial', async () => {
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'lxc', 'pve1', '200'))
    expect(res.status).toBe(403)
  })

  it('404 for unknown connection', async () => {
    getConnectionByIdMock.mockResolvedValueOnce(null)
    const res = await POST(new Request('http://localhost'), makeCtx('x', 'lxc', 'pve1', '200'))
    expect(res.status).toBe(404)
  })

  it('LXC success: returns sessionId + /ws/shell wsUrl, stores guest upstream path', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ baseUrl: 'https://pve1:8006', apiToken: 'tok', insecureDev: false })
    pveFetchMock.mockResolvedValueOnce({ ticket: 'T', port: 5900, user: 'root@pam!t', upid: 'UPID' })
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'lxc', 'pve1', '200'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.wsUrl).toMatch(/^\/ws\/shell\//)
    const stored = takeSingleUse(body.data.sessionId)
    expect(stored).toMatchObject({
      upstreamBasePath: '/api2/json/nodes/pve1/lxc/200',
      ticket: 'T', port: 5900, user: 'root@pam!t',
    })
    expect(body.data).not.toHaveProperty('ticket')
  })

  it('QEMU without serial returns a clear 400 no-serial message', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ baseUrl: 'https://pve1:8006', apiToken: 'tok', insecureDev: false })
    pveFetchMock.mockRejectedValueOnce(new Error("unable to find a serial interface"))
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'qemu', 'pve1', '100'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/serial/i)
  })
})
