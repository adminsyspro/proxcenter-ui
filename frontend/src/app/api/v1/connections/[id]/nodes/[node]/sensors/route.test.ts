import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, getConnByIdMock, getNodeIpMock, executeSSHMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnByIdMock: vi.fn(),
  getNodeIpMock: vi.fn(),
  executeSSHMock: vi.fn(),
}))

vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: any[]) => getConnByIdMock(...a) }))
vi.mock('@/lib/ssh/node-ip', () => ({ getNodeIp: (...a: any[]) => getNodeIpMock(...a) }))
vi.mock('@/lib/ssh/exec', () => ({ executeSSH: (...a: any[]) => executeSSHMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))

// Trimmed from a bare-metal AMD PVE host: one CPU chip and one NVMe.
const HWMON_STDOUT = [
  '/sys/class/hwmon/hwmon1/name:nvme',
  '/sys/class/hwmon/hwmon3/name:k10temp',
  '/sys/class/hwmon/hwmon1/temp1_label:Composite',
  '/sys/class/hwmon/hwmon3/temp1_label:Tctl',
  '/sys/class/hwmon/hwmon1/temp1_input:39850',
  '/sys/class/hwmon/hwmon3/temp1_input:59625',
].join('\n')

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  checkPermissionMock.mockResolvedValue(null)
  getConnByIdMock.mockResolvedValue({ id: 'c1', baseUrl: 'https://pve', apiToken: 'tok' })
  getNodeIpMock.mockResolvedValue('10.0.0.1')
})

// The route memoizes per connection and node, so every case uses its own node
// name to keep a previous case's entry from answering for it.
let nodeSeq = 0
const get = async (node = `pve${++nodeSeq}`) => {
  const { GET } = await import('./route')

  return callRoute(GET, { params: { id: 'c1', node } })
}

describe('GET .../nodes/[node]/sensors', () => {
  it('returns readings grouped by role', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: HWMON_STDOUT })

    const res = await get()
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.available).toBe(true)
    expect(body.data.byRole).toEqual([
      { role: 'cpu', max: 59.6, count: 1 },
      { role: 'disk', max: 39.9, count: 1 },
    ])
    expect(body.data.hottest).toMatchObject({ chip: 'k10temp', celsius: 59.6 })
  })

  it('reads sysfs with a single command carrying no interpolated input', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: HWMON_STDOUT })

    await get()

    const [, ip, command] = executeSSHMock.mock.calls[0]

    expect(ip).toBe('10.0.0.1')
    expect(command).toContain('/sys/class/hwmon/')
    expect(command).not.toContain('pve')
  })

  it('reports unavailable rather than failing when SSH is off', async () => {
    executeSSHMock.mockResolvedValue({ success: false, error: 'SSH not enabled for this connection' })

    const res = await get()
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ available: false, reason: 'ssh-unavailable' })
  })

  it('does not leak the SSH failure detail to the caller', async () => {
    executeSSHMock.mockResolvedValue({ success: false, error: 'Permission denied for root@10.0.0.1' })

    const body = await readJson<any>(await get())

    expect(JSON.stringify(body)).not.toContain('10.0.0.1')
  })

  it('reports unavailable on a node whose chips expose no temperature', async () => {
    // grep matches nothing on a virtualized node, so the command succeeds empty.
    executeSSHMock.mockResolvedValue({ success: true, output: '' })

    const body = await readJson<any>(await get())

    expect(body.data).toEqual({ available: false, reason: 'no-sensors' })
  })

  it('checks the node permission before opening any SSH session', async () => {
    checkPermissionMock.mockResolvedValue(new Response('forbidden', { status: 403 }))

    const res = await get()

    expect(res.status).toBe(403)
    expect(getConnByIdMock).not.toHaveBeenCalled()
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('serves a repeat call from the memo instead of a second SSH session', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: HWMON_STDOUT })

    const node = 'pve-cached'

    await get(node)
    const body = await readJson<any>(await get(node))

    expect(executeSSHMock).toHaveBeenCalledTimes(1)
    expect(body.data.available).toBe(true)
  })

  it('re-checks the permission on a memoized node', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: HWMON_STDOUT })

    const node = 'pve-guarded'

    await get(node)
    checkPermissionMock.mockResolvedValue(new Response('forbidden', { status: 403 }))

    expect((await get(node)).status).toBe(403)
  })

  it('rejects a call with no node', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'c1', node: '' } })

    expect(res.status).toBe(400)
  })

  it('answers 404 for an unknown connection', async () => {
    getConnByIdMock.mockResolvedValue(null)

    expect((await get()).status).toBe(404)
  })
})
