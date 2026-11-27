import { describe, it, expect } from 'vitest'
import { RESOURCE_KINDS, kindByApiKind, NAV_GROUPS } from './resourceKinds'

describe('resourceKinds catalogue', () => {
  const expected = ['node','namespace','pod','deployment','statefulset','daemonset','job','cronjob','service','ingress','configmap','pvc','pv','event']

  it('covers exactly the Standard allowlist', () => {
    expect(RESOURCE_KINDS.map(k => k.apiKind).sort()).toEqual([...expected].sort())
  })

  it('every kind has label, scope, navGroup, icon, and at least one typed column', () => {
    for (const k of RESOURCE_KINDS) {
      expect(k.label.length).toBeGreaterThan(0)
      expect(['namespaced', 'cluster']).toContain(k.scope)
      expect(k.navGroup.length).toBeGreaterThan(0)
      expect(k.icon).toMatch(/^ri-/)
      expect(k.columns.length).toBeGreaterThan(0)
      for (const c of k.columns) {
        expect(['text','number','age','ratio','badge','progress']).toContain(c.type)
      }
    }
  })

  it('cluster-scoped kinds are node/namespace/pv only', () => {
    const cluster = RESOURCE_KINDS.filter(k => k.scope === 'cluster').map(k => k.apiKind).sort()
    expect(cluster).toEqual(['namespace', 'node', 'pv'])
  })

  it('kindByApiKind resolves and rejects', () => {
    expect(kindByApiKind('pod')?.label).toBe('Pods')
    expect(kindByApiKind('secret')).toBeUndefined()
  })

  it('pod kind includes podIP column', () => {
    const pod = kindByApiKind('pod')
    expect(pod?.columns.some(c => c.key === 'podIP')).toBe(true)
  })

  it('NAV_GROUPS reference only catalogue kinds', () => {
    const all = new Set(RESOURCE_KINDS.map(k => k.apiKind))
    for (const g of NAV_GROUPS) for (const k of g.kinds) expect(all.has(k)).toBe(true)
  })
})
