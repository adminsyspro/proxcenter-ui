import { describe, it, expect, vi, beforeEach } from 'vitest'

// Partial mock: setHeaderOptions becomes a spy that delegates to the real
// implementation; CoreV1Api, PatchStrategy, ApiException, etc. stay real.
vi.mock('@kubernetes/client-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kubernetes/client-node')>()
  return { ...actual, setHeaderOptions: vi.fn(actual.setHeaderOptions) }
})

const patchNode = vi.fn()
const readNode = vi.fn()
const listPods = vi.fn()
const evict = vi.fn()
const makeApiClient = vi.fn(() => ({
  patchNode, readNode,
  listPodForAllNamespaces: listPods,
  createNamespacedPodEviction: evict,
}))
vi.mock('./client', () => ({
  buildKubeClient: () => ({ ok: true, makeApiClient }),
}))

import { PatchStrategy, setHeaderOptions } from '@kubernetes/client-node'
import { setNodeCordon, drainNode } from './nodeOps'

const input: any = { clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } }
const rs = (ns: string, n: string) => ({ metadata: { namespace: ns, name: n, ownerReferences: [{ kind: 'ReplicaSet', controller: true }] }, spec: {}, status: {} })

beforeEach(() => {
  patchNode.mockReset().mockResolvedValue({})
  readNode.mockReset().mockResolvedValue({ spec: { unschedulable: true } })
  listPods.mockReset()
  evict.mockReset().mockResolvedValue({})
})

describe('setNodeCordon', () => {
  it('patches spec.unschedulable via setHeaderOptions(strategic-merge) and returns the re-read state', async () => {
    const r = await setNodeCordon(input, 'node-1', true)
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ unschedulable: true })
    const [args, opts] = patchNode.mock.calls[0]
    expect(args).toMatchObject({ name: 'node-1', body: { spec: { unschedulable: true } } })
    // The real mechanism: nodeOps must build its patch options through
    // setHeaderOptions('Content-Type', StrategicMergePatch) and pass that exact
    // configuration as patchNode's 2nd argument.
    const spy = vi.mocked(setHeaderOptions)
    expect(spy).toHaveBeenCalledWith('Content-Type', PatchStrategy.StrategicMergePatch)
    expect(opts).toBe(spy.mock.results[0].value)
  })
})

describe('drainNode', () => {
  it('dryRun classifies without cordoning or evicting', async () => {
    listPods.mockResolvedValue({ items: [rs('a', 'web-1')] })
    const r = await drainNode(input, 'node-1', { force: false, dryRun: true })
    expect(r.ok).toBe(true)
    expect(r.value!.cordoned).toBe(false)
    expect(r.value!.remaining.map(p => p.name)).toEqual(['web-1'])
    expect(patchNode).not.toHaveBeenCalled()
    expect(evict).not.toHaveBeenCalled()
  })

  it('evicts, treats 404 as gone, keeps 429 (PDB) as blocked/remaining', async () => {
    listPods
      .mockResolvedValueOnce({ items: [rs('a', 'web-1'), rs('a', 'web-2')] }) // classify
      .mockResolvedValueOnce({ items: [rs('a', 'web-2')] })                    // re-list: web-2 still there
    evict
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 404 }))  // web-1
      .mockRejectedValueOnce(Object.assign(new Error('pdb'), { code: 429 }))   // web-2
    const r = await drainNode(input, 'node-1', { force: false, dryRun: false })
    expect(patchNode).toHaveBeenCalled() // cordoned
    expect(r.value!.evicted).toBe(1)                                   // web-1 (404 => gone)
    expect(r.value!.blockedByPdb.map(p => p.name)).toEqual(['web-2'])
    expect(r.value!.remaining.map(p => p.name)).toEqual(['web-2'])
    expect(r.value!.done).toBe(false)
  })

  it('records a non-404/429 eviction failure (with HTTP-code reason) instead of hiding it in remaining', async () => {
    listPods
      .mockResolvedValueOnce({ items: [rs('a', 'web-1')] }) // classify
      .mockResolvedValueOnce({ items: [rs('a', 'web-1')] }) // re-list: still present
    evict.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 500 }))
    const r = await drainNode(input, 'node-1', { force: false, dryRun: false })
    expect(r.ok).toBe(true)
    expect(r.value!.evicted).toBe(0)
    expect(r.value!.blockedByPdb).toEqual([])
    expect(r.value!.evictionFailures.map(p => p.name)).toEqual(['web-1'])
    expect(r.value!.evictionFailureReason).toBe('HTTP 500')
    // Still surfaced in remaining so the client loop keeps the pod visible.
    expect(r.value!.remaining.map(p => p.name)).toEqual(['web-1'])
    expect(r.value!.done).toBe(false)
  })

  it('prefers the apiserver message as the eviction-failure reason when present', async () => {
    listPods
      .mockResolvedValueOnce({ items: [rs('a', 'web-1')] })
      .mockResolvedValueOnce({ items: [rs('a', 'web-1')] })
    evict.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 403, body: { message: 'admission webhook denied the request' } }))
    const r = await drainNode(input, 'node-1', { force: false, dryRun: false })
    expect(r.value!.evictionFailures.map(p => p.name)).toEqual(['web-1'])
    expect(r.value!.evictionFailureReason).toBe('admission webhook denied the request')
  })

  it('stays ok and falls back to not-confirmed-gone pods when the final re-list fails', async () => {
    listPods
      .mockResolvedValueOnce({ items: [rs('a', 'web-1'), rs('a', 'web-2')] })      // classify
      .mockRejectedValueOnce(Object.assign(new Error('relist down'), { code: 500 })) // re-list fails
    evict
      .mockResolvedValueOnce({})                                                   // web-1 evicted
      .mockRejectedValueOnce(Object.assign(new Error('pdb'), { code: 429 }))       // web-2 blocked
    const r = await drainNode(input, 'node-1', { force: false, dryRun: false })
    // The drain already mutated the cluster, so the call must not turn into
    // ok:false; remaining comes from the failure fallback (not confirmed gone).
    expect(r.ok).toBe(true)
    expect(r.value!.evicted).toBe(1)
    expect(r.value!.remaining.map(p => p.name)).toEqual(['web-2'])
    expect(r.value!.blockedByPdb.map(p => p.name)).toEqual(['web-2'])
    expect(r.value!.done).toBe(false)
  })
})
