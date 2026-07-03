import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  buildVmResourceId: vi.fn<(id: string, node: string, type: string, vmid: string) => string>(
    (id, node, type, vmid) => `${id}/${node}/${type}/${vmid}`,
  ),
  PERMISSIONS: { VM_CONFIG: 'vm.config', VM_VIEW: 'vm.view' },
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: vi.fn<(...args: any[]) => Promise<string>>(),
}))

// NOTE: @/lib/ssh/validate is intentionally NOT mocked — the real assertVmid
// is what this suite exercises.

import { POST } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any
const getNodeIpMock = getNodeIp as any

const CONN_ID = 'conn-1'
const NODE = 'pve-node-01'
const NODE_IP = '10.0.0.1'

const baseParams = { id: CONN_ID, type: 'qemu', node: NODE, vmid: '100' }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockResolvedValue({ lock: 'backup' })
  getNodeIpMock.mockResolvedValue(NODE_IP)
  executeSSHMock.mockResolvedValue({ success: true, output: 'ok' })
})

describe('POST .../unlock — happy path', () => {
  it('unlocks a QEMU VM and runs `qm unlock <vmid>` over SSH', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: baseParams })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.unlocked).toBe(true)
    expect(executeSSHMock).toHaveBeenCalledWith(CONN_ID, NODE_IP, 'qm unlock 100')
  })

  it('uses `pct unlock` for LXC containers', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { ...baseParams, type: 'lxc' },
    })
    expect(res.status).toBe(200)
    expect(executeSSHMock).toHaveBeenCalledWith(CONN_ID, NODE_IP, 'pct unlock 100')
  })

  it('rejects a vmid with leading zeros (grammar) with 400', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { ...baseParams, vmid: '00100' },
    })
    expect(res.status).toBe(400)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })
})

describe('POST .../unlock — vmid validation (command injection)', () => {
  const MALICIOUS = [
    '100; touch /tmp/pwn',
    '$(id)',
    '`whoami`',
    '100 && reboot',
    '100|cat /etc/passwd',
    '100abc',
  ]

  for (const vmid of MALICIOUS) {
    it(`rejects ${JSON.stringify(vmid)} with 400 and never runs SSH`, async () => {
      const res = await callRoute(POST as any, { method: 'POST', params: { ...baseParams, vmid } })
      expect(res.status).toBe(400)
      const body = await readJson<any>(res)
      expect(body.error).toMatch(/invalid vmid/i)
      // Rejection happens before RBAC / config probe / SSH.
      expect(checkPermissionMock).not.toHaveBeenCalled()
      expect(pveFetchMock).not.toHaveBeenCalled()
      expect(executeSSHMock).not.toHaveBeenCalled()
    })
  }
})
