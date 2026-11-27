import { describe, it, expect } from 'vitest'
import { classifyDrainPods, shouldContinueDrain, type DrainResult } from './nodeDrain'

function pod(namespace: string, name: string, extra: any = {}): any {
  return { metadata: { namespace, name, ...(extra.metadata ?? {}) }, spec: extra.spec ?? {}, status: extra.status ?? {} }
}
const ds = (ns: string, n: string) => pod(ns, n, { metadata: { ownerReferences: [{ kind: 'DaemonSet', controller: true }] } })
const rs = (ns: string, n: string) => pod(ns, n, { metadata: { ownerReferences: [{ kind: 'ReplicaSet', controller: true }] } })

describe('classifyDrainPods', () => {
  it('skips terminal, mirror, and DaemonSet pods; evicts controller-managed pods', () => {
    const pods = [
      pod('a', 'succeeded', { status: { phase: 'Succeeded' } }),
      pod('a', 'mirror', { metadata: { annotations: { 'kubernetes.io/config.mirror': 'x' } } }),
      ds('kube-system', 'ds-1'),
      rs('a', 'web-1'),
    ]
    const c = classifyDrainPods(pods, { force: false })
    expect(c.skipped.map(p => p.name).sort()).toEqual(['ds-1', 'mirror', 'succeeded'])
    expect(c.evict.map(p => p.name)).toEqual(['web-1'])
  })

  it('refuses emptyDir and unmanaged pods unless force', () => {
    const pods = [
      pod('a', 'with-ed', { spec: { volumes: [{ name: 'v', emptyDir: {} }] }, metadata: { ownerReferences: [{ kind: 'ReplicaSet', controller: true }] } }),
      pod('a', 'bare'),
    ]
    const soft = classifyDrainPods(pods, { force: false })
    expect(soft.refusedEmptyDir.map(p => p.name)).toEqual(['with-ed'])
    expect(soft.refusedUnmanaged.map(p => p.name)).toEqual(['bare'])
    expect(soft.evict).toEqual([])
    const forced = classifyDrainPods(pods, { force: true })
    expect(forced.evict.map(p => p.name).sort()).toEqual(['bare', 'with-ed'])
    expect(forced.refusedEmptyDir).toEqual([])
    expect(forced.refusedUnmanaged).toEqual([])
  })

  it('classification order: a DaemonSet pod with emptyDir is skipped, not refused', () => {
    const p = pod('kube-system', 'ds-ed', {
      metadata: { ownerReferences: [{ kind: 'DaemonSet', controller: true }] },
      spec: { volumes: [{ name: 'v', emptyDir: {} }] },
    })
    const c = classifyDrainPods([p], { force: false })
    expect(c.skipped.map(x => x.name)).toEqual(['ds-ed'])
    expect(c.refusedEmptyDir).toEqual([])
  })
})

describe('shouldContinueDrain', () => {
  const base: DrainResult = { cordoned: true, evicted: 0, skipped: 0, remaining: [], blockedByPdb: [], evictionFailures: [], refusedEmptyDir: [], refusedUnmanaged: [], done: false }
  it('continues while evictable pods remain (incl. PDB-blocked / terminating)', () => {
    expect(shouldContinueDrain({ ...base, remaining: [{ namespace: 'a', name: 'web-1' }] })).toBe(true)
  })
  it('stops when nothing remains', () => {
    expect(shouldContinueDrain({ ...base, remaining: [], done: true })).toBe(false)
  })
  it('stops when only refused pods are left (a loop cannot clear them)', () => {
    expect(shouldContinueDrain({ ...base, remaining: [], refusedEmptyDir: [{ namespace: 'a', name: 'x' }] })).toBe(false)
  })
})
