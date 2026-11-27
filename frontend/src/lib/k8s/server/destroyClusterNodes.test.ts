import { describe, it, expect, vi } from 'vitest'
import { parseCicustomSnippet, destroyOneNode, destroyClusterNodesWith, type DestroyDeps } from './destroyClusterNodes'

describe('parseCicustomSnippet', () => {
  it('extracts the user snippet volid + storage', () => {
    expect(parseCicustomSnippet('user=local:snippets/foo-user-data.yaml'))
      .toEqual({ storage: 'local', volid: 'local:snippets/foo-user-data.yaml' })
  })
  it('handles multi-field cicustom (user + network)', () => {
    expect(parseCicustomSnippet('network=local:snippets/net.yaml,user=local:snippets/u.yaml'))
      .toEqual({ storage: 'local', volid: 'local:snippets/u.yaml' })
  })
  it('returns null when no user snippet / empty / malformed', () => {
    expect(parseCicustomSnippet('')).toBeNull()
    expect(parseCicustomSnippet(null)).toBeNull()
    expect(parseCicustomSnippet('network=local:snippets/net.yaml')).toBeNull()
    expect(parseCicustomSnippet('user=novolidcolon')).toBeNull()
  })
})

function fakeDeps(over: Partial<DestroyDeps> = {}): DestroyDeps {
  return {
    locate: async () => ({ node: 'pve1', status: 'running' }),
    getCicustom: async () => 'user=local:snippets/u.yaml',
    stop: vi.fn(async () => {}),
    waitStopped: vi.fn(async () => {}),
    deleteVm: vi.fn(async () => {}),
    deleteSnippet: vi.fn(async () => {}),
    releaseIpam: vi.fn(async () => {}),
    isNotFound: () => false,
    ...over,
  }
}

describe('destroyOneNode', () => {
  it('happy path: stop -> wait -> deleteVm -> deleteSnippet -> ipam, status destroyed', async () => {
    const d = fakeDeps()
    const r = await destroyOneNode(d, 9001, 'cp-1')
    expect(r.status).toBe('destroyed')
    expect(d.stop).toHaveBeenCalledOnce()
    expect(d.waitStopped).toHaveBeenCalledOnce()
    expect(d.deleteVm).toHaveBeenCalledOnce()
    expect(d.deleteSnippet).toHaveBeenCalledOnce()
    expect(d.releaseIpam).toHaveBeenCalledOnce()
  })
  it('skips stop when the VM is already stopped', async () => {
    const d = fakeDeps({ locate: async () => ({ node: 'pve1', status: 'stopped' }) })
    await destroyOneNode(d, 9001)
    expect(d.stop).not.toHaveBeenCalled()
    expect(d.deleteVm).toHaveBeenCalledOnce()
  })
  it('already-gone when locate returns null', async () => {
    const r = await destroyOneNode(fakeDeps({ locate: async () => null }), 9001)
    expect(r.status).toBe('already-gone')
  })
  it('already-gone when a call throws a not-found error', async () => {
    const r = await destroyOneNode(fakeDeps({ deleteVm: async () => { throw new Error('nf') }, isNotFound: () => true }), 9001)
    expect(r.status).toBe('already-gone')
  })
  it('error when stop/delete throws a real error (kept for retry)', async () => {
    const r = await destroyOneNode(fakeDeps({ deleteVm: async () => { throw new Error('boom') } }), 9001)
    expect(r.status).toBe('error')
    expect(r.error).toContain('boom')
  })
  it('snippet delete failure is non-fatal (still destroyed, with a warning)', async () => {
    const r = await destroyOneNode(fakeDeps({ deleteSnippet: async () => { throw new Error('snip') } }), 9001)
    expect(r.status).toBe('destroyed')
    expect(r.snippetWarning).toContain('snip')
  })
})

describe('destroyClusterNodesWith', () => {
  const nodes = [
    { nodeName: 'a', connectionId: 'c1', vmid: 1 },
    { nodeName: 'b', connectionId: 'c1', vmid: 2 },
  ]
  it('allOk true when all destroyed/already-gone', async () => {
    const res = await destroyClusterNodesWith(nodes, async (_c, vmid, n) => ({ vmid, nodeName: n, status: vmid === 1 ? 'destroyed' : 'already-gone' }))
    expect(res.allOk).toBe(true)
    expect(res.results).toHaveLength(2)
  })
  it('allOk false when any node errored', async () => {
    const res = await destroyClusterNodesWith(nodes, async (_c, vmid, n) => ({ vmid, nodeName: n, status: vmid === 2 ? 'error' : 'destroyed', error: vmid === 2 ? 'x' : undefined }))
    expect(res.allOk).toBe(false)
  })
  it('converts a thrown per-node destroy into an error result (does not propagate)', async () => {
    const throwingNodes = [
      { nodeName: 'a', connectionId: 'c1', vmid: 1 },
      { nodeName: 'b', connectionId: 'gone', vmid: 2 },
    ]
    const res = await destroyClusterNodesWith(throwingNodes, async (connId, vmid, n) => {
      if (connId === 'gone') throw new Error('Connection not found')
      return { vmid, nodeName: n, status: 'destroyed' }
    })
    expect(res.allOk).toBe(false)
    expect(res.results.find(r => r.vmid === 2)).toMatchObject({ status: 'error', error: expect.stringContaining('Connection not found') })
    expect(res.results.find(r => r.vmid === 1)?.status).toBe('destroyed')
  })
})
