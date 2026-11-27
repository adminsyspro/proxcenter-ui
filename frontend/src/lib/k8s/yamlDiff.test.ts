import { describe, it, expect } from 'vitest'
import { normalizeForCompare, diffLines, MAX_DIFF_LINES } from './yamlDiff'

describe('normalizeForCompare', () => {
  it('drops the fields Kubernetes writes for itself and keeps the configuration', () => {
    const yaml = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: web',
      '  uid: 123',
      '  resourceVersion: "77"',
      '  generation: 4',
      '  creationTimestamp: 2026-01-01T00:00:00Z',
      '  annotations:',
      '    deployment.kubernetes.io/revision: "3"',
      'spec:',
      '  replicas: 2',
      'status:',
      '  readyReplicas: 2',
    ].join('\n')
    expect(normalizeForCompare(yaml)).toBe('apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n')
  })
  it('keeps annotations a person set', () => {
    const out = normalizeForCompare('metadata:\n  name: a\n  annotations:\n    team: shop\n    kubectl.kubernetes.io/last-applied-configuration: "{}"\n')
    expect(out).toBe('metadata:\n  name: a\n  annotations:\n    team: shop\n')
  })
  it('returns text that is not a YAML mapping unchanged', () => {
    expect(normalizeForCompare('just text')).toBe('just text')
    expect(normalizeForCompare('a: [')).toBe('a: [')
  })
})

describe('diffLines', () => {
  it('reports identical texts as unchanged', () => {
    const r = diffLines('a\nb\n', 'a\nb\n')
    expect(r.changes).toBe(0)
    expect(r.rows.map(x => x.type)).toEqual(['same', 'same'])
  })
  it('puts the two versions of a changed line face to face', () => {
    const r = diffLines('name: web\nimage: nginx:1\nreplicas: 2', 'name: web\nimage: nginx:2\nreplicas: 2')
    expect(r.rows).toEqual([
      { type: 'same', left: 'name: web', right: 'name: web' },
      { type: 'changed', left: 'image: nginx:1', right: 'image: nginx:2' },
      { type: 'same', left: 'replicas: 2', right: 'replicas: 2' },
    ])
    expect(r.changes).toBe(1)
  })
  it('shows lines present on one side only', () => {
    const r = diffLines('a\nb\nc', 'a\nc\nd')
    expect(r.rows).toEqual([
      { type: 'same', left: 'a', right: 'a' },
      { type: 'removed', left: 'b', right: undefined },
      { type: 'same', left: 'c', right: 'c' },
      { type: 'added', left: undefined, right: 'd' },
    ])
  })
  it('cuts very long documents and says so', () => {
    const long = Array.from({ length: MAX_DIFF_LINES + 5 }, (_, i) => `l${i}`).join('\n')
    const r = diffLines(long, long)
    expect(r.truncated).toBe(true)
    expect(r.rows).toHaveLength(MAX_DIFF_LINES)
  })
})
