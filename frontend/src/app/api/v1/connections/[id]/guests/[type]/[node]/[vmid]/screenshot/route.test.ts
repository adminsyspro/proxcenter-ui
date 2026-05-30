import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const getConnectionByIdMock = vi.fn()
const pveFetchMock = vi.fn()
const locateVmInClusterMock = vi.fn()
const checkPermissionMock = vi.fn()
const executeSSHMock = vi.fn()
const getNodeIpMock = vi.fn()

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...args: unknown[]) => getConnectionByIdMock(...args),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: (...args: unknown[]) => pveFetchMock(...args),
}))

vi.mock('@/lib/proxmox/locateVm', () => ({
  locateVmInCluster: (...args: unknown[]) => locateVmInClusterMock(...args),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) =>
    `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_CONSOLE: 'vm.console' },
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: (...args: unknown[]) => executeSSHMock(...args),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: (...args: unknown[]) => getNodeIpMock(...args),
}))

import { GET, pruneScreenshotCaches } from './route'

// Each test uses a unique id/vmid so the module-level screenshot and
// framebuffer caches (keyed by `id:node:vmid`) never bleed across cases.
let seq = 0
function makeCtx(over: Partial<{ id: string; type: string; node: string; vmid: string }> = {}) {
  seq += 1
  const params = {
    id: over.id ?? `conn-${seq}`,
    type: over.type ?? 'qemu',
    node: over.node ?? 'pve1',
    vmid: over.vmid ?? `${100 + seq}`,
  }
  return { params: Promise.resolve(params) }
}

beforeEach(() => {
  getConnectionByIdMock.mockReset()
  pveFetchMock.mockReset()
  locateVmInClusterMock.mockReset()
  checkPermissionMock.mockReset()
  executeSSHMock.mockReset()
  getNodeIpMock.mockReset()

  checkPermissionMock.mockResolvedValue(null) // allow by default
  getConnectionByIdMock.mockResolvedValue({ id: 'c', baseUrl: 'https://pve:8006', apiToken: 't' })
  getNodeIpMock.mockResolvedValue('10.0.0.1')
})

describe('GET .../screenshot — display detection', () => {
  it('returns reason=no_display for a serial-only VM and never runs SSH', async () => {
    pveFetchMock.mockResolvedValueOnce({ vga: 'serial0' })

    const res = await GET(new Request('http://localhost'), makeCtx())
    const body = await res.json()

    expect(body).toEqual({ data: null, reason: 'no_display' })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('treats vga: none (e.g. GPU passthrough) as no_display', async () => {
    pveFetchMock.mockResolvedValueOnce({ vga: 'none' })

    const res = await GET(new Request('http://localhost'), makeCtx())
    const body = await res.json()

    expect(body.reason).toBe('no_display')
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('captures a screenshot for a graphical VM (vga: std)', async () => {
    pveFetchMock.mockResolvedValueOnce({ vga: 'std' })
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'QkFTRTY0\n' })

    const res = await GET(new Request('http://localhost'), makeCtx())
    const body = await res.json()

    expect(body).toMatchObject({ data: 'QkFTRTY0', format: 'ppm' })
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
  })

  it('treats an absent vga (default std) as graphical and proceeds to SSH', async () => {
    pveFetchMock.mockResolvedValueOnce({})
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'ZGF0YQ==' })

    const res = await GET(new Request('http://localhost'), makeCtx())
    const body = await res.json()

    expect(body.format).toBe('ppm')
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
  })

  it('caches the no_display verdict: a second poll does not re-probe the config', async () => {
    const ctxArgs = { id: 'cached-conn', node: 'pve1', vmid: '777' }
    pveFetchMock.mockResolvedValueOnce({ vga: 'serial0' })

    const first = await (await GET(new Request('http://localhost'), makeCtx(ctxArgs))).json()
    const second = await (await GET(new Request('http://localhost'), makeCtx(ctxArgs))).json()

    expect(first.reason).toBe('no_display')
    expect(second.reason).toBe('no_display')
    // Config probed once; the second call is served from hasFramebufferCache.
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls through to the screendump path when the config probe fails', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error('node down'))
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'b2s=' })

    const res = await GET(new Request('http://localhost'), makeCtx())
    const body = await res.json()

    expect(body.format).toBe('ppm')
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
  })

  it('short-circuits LXC guests before any display probe', async () => {
    const res = await GET(new Request('http://localhost'), makeCtx({ type: 'lxc' }))
    const body = await res.json()

    expect(body).toEqual({ data: null, reason: 'lxc' })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('pruneScreenshotCaches evicts stale entries so the VM is re-probed', async () => {
    const ctxArgs = { id: 'prune-conn', node: 'pve1', vmid: '888' }
    pveFetchMock.mockResolvedValue({ vga: 'serial0' })

    // First poll populates the framebuffer cache.
    await GET(new Request('http://localhost'), makeCtx(ctxArgs))
    expect(pveFetchMock).toHaveBeenCalledTimes(1)

    // Far-future "now" makes every entry older than 2x its TTL → evicted.
    pruneScreenshotCaches(Date.now() + 10 * 60_000)

    // Cache miss now, so the config is probed again rather than served stale.
    await GET(new Request('http://localhost'), makeCtx(ctxArgs))
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
  })
})
