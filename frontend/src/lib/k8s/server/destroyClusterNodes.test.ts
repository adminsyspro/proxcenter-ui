import { describe, it, expect, vi } from 'vitest'
import { parseCicustomSnippet, isDeployedNode, checkOneNode, destroyOneNode, destroyClusterNodesWith, type DestroyDeps } from './destroyClusterNodes'

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
    getConfig: async () => ({ name: 'cp-1', tags: 'proxcenter;dev', cicustom: 'user=local:snippets/u.yaml' }),
    stop: vi.fn(async () => {}),
    waitStopped: vi.fn(async () => {}),
    deleteVm: vi.fn(async () => {}),
    deleteSnippet: vi.fn(async () => {}),
    releaseIpam: vi.fn(async () => {}),
    isNotFound: () => false,
    ...over,
  }
}

describe('isDeployedNode', () => {
  it('recognises the VM by its name and the tags every module sets', () => {
    expect(isDeployedNode({ name: 'cp-1', tags: 'proxcenter;dev' }, 'cp-1', 'dev')).toBe(true)
    expect(isDeployedNode({ name: 'cp-1', tags: 'Dev,ProxCenter' }, 'cp-1', 'dev')).toBe(true)
  })
  it('refuses another VM at the same VMID', () => {
    expect(isDeployedNode({ name: 'web-01', tags: 'proxcenter;dev' }, 'cp-1', 'dev')).toBe(false)
    expect(isDeployedNode({ name: 'cp-1', tags: 'proxcenter;prod' }, 'cp-1', 'dev')).toBe(false)
    expect(isDeployedNode({ name: 'cp-1' }, 'cp-1', 'dev')).toBe(false)
    expect(isDeployedNode(null, 'cp-1', 'dev')).toBe(false)
  })
})

describe('destroyOneNode', () => {
  it('leaves a VM that is no longer the deployed node untouched', async () => {
    const d = fakeDeps({ getConfig: async () => ({ name: 'someone-elses-vm', tags: 'prod' }) })
    const r = await destroyOneNode(d, 9001, 'cp-1', 'dev')
    expect(r.status).toBe('error')
    expect(r.error).toContain('no longer node cp-1')
    expect(d.stop).not.toHaveBeenCalled()
    expect(d.deleteVm).not.toHaveBeenCalled()
    expect(d.deleteSnippet).not.toHaveBeenCalled()
  })

  it('happy path: stop -> wait -> deleteVm -> deleteSnippet -> ipam, status destroyed', async () => {
    const d = fakeDeps()
    const r = await destroyOneNode(d, 9001, 'cp-1', 'dev')
    expect(r.status).toBe('destroyed')
    expect(d.stop).toHaveBeenCalledOnce()
    expect(d.waitStopped).toHaveBeenCalledOnce()
    expect(d.deleteVm).toHaveBeenCalledOnce()
    expect(d.deleteSnippet).toHaveBeenCalledOnce()
    expect(d.releaseIpam).toHaveBeenCalledOnce()
  })
  it('skips stop when the VM is already stopped', async () => {
    const d = fakeDeps({ locate: async () => ({ node: 'pve1', status: 'stopped' }) })
    await destroyOneNode(d, 9001, 'cp-1', 'dev')
    expect(d.stop).not.toHaveBeenCalled()
    expect(d.deleteVm).toHaveBeenCalledOnce()
  })
  it('already-gone when locate returns null', async () => {
    const r = await destroyOneNode(fakeDeps({ locate: async () => null }), 9001, 'cp-1', 'dev')
    expect(r.status).toBe('already-gone')
  })
  it('already-gone when a call throws a not-found error', async () => {
    const r = await destroyOneNode(fakeDeps({ deleteVm: async () => { throw new Error('nf') }, isNotFound: () => true }), 9001, 'cp-1', 'dev')
    expect(r.status).toBe('already-gone')
  })
  it('error when stop/delete throws a real error (kept for retry)', async () => {
    const r = await destroyOneNode(fakeDeps({ deleteVm: async () => { throw new Error('boom') } }), 9001, 'cp-1', 'dev')
    expect(r.status).toBe('error')
    expect(r.error).toContain('boom')
  })
  it('snippet delete failure is non-fatal (still destroyed, with a warning)', async () => {
    const r = await destroyOneNode(fakeDeps({ deleteSnippet: async () => { throw new Error('snip') } }), 9001, 'cp-1', 'dev')
    expect(r.status).toBe('destroyed')
    expect(r.snippetWarning).toContain('snip')
  })
})

describe('destroyClusterNodesWith with a check', () => {
  const nodes = [
    { nodeName: 'dev-cp-1', connectionId: 'c', vmid: 1 },
    { nodeName: 'dev-worker-1', connectionId: 'c', vmid: 2 },
  ]
  it('destroys nothing when one VM is refused: the others are kept', async () => {
    const destroy = vi.fn()
    const res = await destroyClusterNodesWith(nodes, destroy, async (_c, vmid) => (vmid === 2 ? 'renamed' : null))
    expect(destroy).not.toHaveBeenCalled()
    expect(res.allOk).toBe(false)
    expect(res.results).toEqual([
      { vmid: 1, nodeName: 'dev-cp-1', status: 'kept' },
      { vmid: 2, nodeName: 'dev-worker-1', status: 'error', error: 'renamed' },
    ])
  })
  it('a check that throws refuses too', async () => {
    const destroy = vi.fn()
    const res = await destroyClusterNodesWith(nodes, destroy, async () => { throw new Error('unreachable') })
    expect(destroy).not.toHaveBeenCalled()
    expect(res.results.map(r => r.error)).toEqual(['unreachable', 'unreachable'])
  })
  it('destroys every node once all are recognised', async () => {
    const res = await destroyClusterNodesWith(nodes, async (_c, vmid, n) => ({ vmid, nodeName: n, status: 'destroyed' }), async () => null)
    expect(res.allOk).toBe(true)
  })
})

describe('checkOneNode', () => {
  it('accepts the deployed node and a VM already gone, refuses another VM', async () => {
    const at = { locate: async () => ({ node: 'pve1', status: 'running' }) }
    expect(await checkOneNode({ ...at, getConfig: async () => ({ name: 'cp-1', tags: 'proxcenter;dev' }) }, 9, 'cp-1', 'dev')).toBeNull()
    expect(await checkOneNode({ locate: async () => null, getConfig: async () => null }, 9, 'cp-1', 'dev')).toBeNull()
    expect(await checkOneNode({ ...at, getConfig: async () => ({ name: 'web-01', tags: 'prod' }) }, 9, 'cp-1', 'dev')).toContain('no longer node cp-1')
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
