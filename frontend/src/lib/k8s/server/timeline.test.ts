import { describe, it, expect, vi, beforeEach } from 'vitest'

const core = { listEventForAllNamespaces: vi.fn(), listNamespacedEvent: vi.fn() }
const apps = {
  listReplicaSetForAllNamespaces: vi.fn(), listNamespacedReplicaSet: vi.fn(),
  listControllerRevisionForAllNamespaces: vi.fn(), listNamespacedControllerRevision: vi.fn(),
}
let buildOk = true
vi.mock('./client', () => ({
  buildKubeClient: () => (buildOk
    ? { ok: true, makeApiClient: (cls: any) => (cls === CoreV1Api ? core : apps) }
    : { ok: false }),
}))

import { CoreV1Api } from '@kubernetes/client-node'
import { eventEntry, rolloutEntries, revisionTime, rolloutChange, actionEntry, mergeTimeline, readClusterHistory, TIMELINE_LIST_LIMIT, TIMELINE_MAX_ENTRIES } from './timeline'

const input: any = { clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } }
const owner = (kind: string, name: string, uid: string) => [{ kind, name, uid, controller: true }]
const rs = (rev: number, image: string, at: string, uid = 'd1') => ({
  metadata: { namespace: 'shop', creationTimestamp: new Date(at), annotations: { 'deployment.kubernetes.io/revision': String(rev) }, ownerReferences: owner('Deployment', 'web', uid) },
  spec: { template: { spec: { containers: [{ image }] } } },
})
const cr = (rev: number, image: string, at: string) => ({
  metadata: { namespace: 'shop', creationTimestamp: new Date(at), ownerReferences: owner('StatefulSet', 'db', 's1') },
  revision: rev, data: { spec: { template: { spec: { containers: [{ image }] } } } },
})

beforeEach(() => {
  buildOk = true
  for (const fn of [...Object.values(core), ...Object.values(apps)]) fn.mockReset().mockResolvedValue({ items: [] })
})

describe('eventEntry', () => {
  it('keeps the involved object, its namespace, and the latest time', () => {
    expect(eventEntry({
      type: 'Warning', reason: 'BackOff', message: 'Back-off', count: 4, lastTimestamp: new Date('2026-11-27T08:00:00Z'),
      involvedObject: { kind: 'Pod', name: 'web-1', namespace: 'shop' },
    })).toEqual({ source: 'event', at: '2026-11-27T08:00:00Z', kind: 'pod', namespace: 'shop', name: 'web-1', type: 'Warning', reason: 'BackOff', message: 'Back-off', count: 4 })
  })
  it('falls back to eventTime when the event has no lastTimestamp', () => {
    expect(eventEntry({ eventTime: new Date('2026-11-27T09:00:00Z'), involvedObject: {} }).at).toBe('2026-11-27T09:00:00Z')
  })
})

describe('rolloutEntries', () => {
  it('gives each revision after the first the images before and after', () => {
    const out = rolloutEntries(
      [rs(2, 'web:2', '2026-11-27T02:00:00Z'), rs(1, 'web:1', '2026-11-27T01:00:00Z'), rs(3, 'web:1', '2026-11-27T03:00:00Z')],
      [cr(1, 'db:1', '2026-11-27T01:00:00Z'), cr(2, 'db:2', '2026-11-27T04:00:00Z')],
    )
    expect(out.map(e => e.source === 'rollout' && [e.kind, e.name, e.revision, e.previousImages[0], e.images[0], e.change])).toEqual([
      ['deployment', 'web', 2, 'web:1', 'web:2', 'image'],
      ['deployment', 'web', 3, 'web:2', 'web:1', 'image'],
      ['statefulset', 'db', 2, 'db:1', 'db:2', 'image'],
    ])
  })
  it('ignores ReplicaSets without a Deployment owner or revision', () => {
    const orphan = { metadata: { annotations: { 'deployment.kubernetes.io/revision': '1' } } }
    const noRev = { metadata: { ownerReferences: owner('Deployment', 'x', 'd9') } }
    expect(rolloutEntries([orphan, noRev], [])).toEqual([])
  })
})

describe('revisionTime and rolloutChange', () => {
  it('dates a reused ReplicaSet by its last write, a new one by its creation', () => {
    const created = new Date('2026-11-27T01:00:00Z')
    expect(revisionTime({ metadata: { creationTimestamp: created } })).toBe('2026-11-27T01:00:00Z')
    expect(revisionTime({ metadata: {
      creationTimestamp: created,
      annotations: { 'deployment.kubernetes.io/revision-history': '1' },
      managedFields: [{ time: new Date('2026-11-27T05:00:00Z') }, { time: new Date('2026-11-27T03:00:00Z') }],
    } })).toBe('2026-11-27T05:00:00Z')
  })
  const tpl = (image: string, extra: Record<string, unknown> = {}) => ({ metadata: { labels: { app: 'a', 'pod-template-hash': image }, annotations: extra }, spec: { containers: [{ image }] } })
  it('tells an image change, a restart and another template change apart', () => {
    expect(rolloutChange({ images: ['a:1'], template: tpl('a:1') }, { images: ['a:2'], template: tpl('a:2') })).toBe('image')
    expect(rolloutChange(
      { images: ['a:1'], template: tpl('a:1') },
      { images: ['a:1'], template: tpl('a:1', { 'kubectl.kubernetes.io/restartedAt': 'now' }) },
    )).toBe('restart')
    const bare = { metadata: { labels: { app: 'a' } }, spec: { containers: [{ image: 'a:1' }] } }
    expect(rolloutChange({ images: ['a:1'], template: bare }, { images: ['a:1'], template: tpl('a:1', { 'kubectl.kubernetes.io/restartedAt': 'now' }) })).toBe('restart')
    const resized = tpl('a:1'); (resized.spec.containers[0] as any).resources = { requests: { cpu: '2' } }
    expect(rolloutChange({ images: ['a:1'], template: tpl('a:1') }, { images: ['a:1'], template: resized })).toBe('config')
  })
})

describe('actionEntry', () => {
  const row = { timestamp: new Date('2026-11-27T10:00:00Z'), action: 'scale', status: 'success', resourceType: 'kubernetesWorkload', resourceName: 'web', userEmail: 'a@b', details: { replicas: 2 } }
  it('reads workload, node and cluster resource ids', () => {
    expect(actionEntry({ ...row, resourceId: 'c1/shop/deployment/web' })).toMatchObject({ source: 'action', kind: 'deployment', namespace: 'shop', name: 'web', action: 'scale', user: 'a@b', details: { replicas: 2 } })
    expect(actionEntry({ ...row, resourceId: 'c1/n1' })).toMatchObject({ kind: 'node', name: 'n1' })
    expect(actionEntry({ ...row, resourceId: 'c1', resourceName: 'lab' })).toMatchObject({ kind: 'cluster', name: 'lab' })
  })
  it('leaves the user out when it is not given', () => {
    expect(actionEntry({ ...row, resourceId: 'c1', userEmail: null }).source === 'action' && actionEntry({ ...row, resourceId: 'c1', userEmail: null })).toMatchObject({ user: undefined })
  })
})

describe('mergeTimeline', () => {
  it('sorts newest first, filters a namespace, drops undated entries and caps the list', () => {
    const e = (at: string, namespace?: string) => ({ source: 'event' as const, at, kind: 'pod', namespace, name: 'p', type: '', reason: '', message: '', count: 1 })
    expect(mergeTimeline([e('2026-01-01T00:00:00Z', 'a'), e('2026-01-03T00:00:00Z', 'b'), e('', 'a'), e('2026-01-02T00:00:00Z', 'a')], 'a').map(x => x.at))
      .toEqual(['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z'])
    const many = Array.from({ length: TIMELINE_MAX_ENTRIES + 10 }, (_, i) => e(`2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`))
    expect(mergeTimeline(many)).toHaveLength(TIMELINE_MAX_ENTRIES)
  })
})

describe('readClusterHistory', () => {
  it('reads the three lists with a page limit, cluster-wide or for one namespace', async () => {
    await readClusterHistory(input)
    expect(core.listEventForAllNamespaces).toHaveBeenCalledWith({ limit: TIMELINE_LIST_LIMIT })
    expect(apps.listReplicaSetForAllNamespaces).toHaveBeenCalledWith({ limit: TIMELINE_LIST_LIMIT })
    await readClusterHistory(input, 'shop')
    expect(apps.listNamespacedControllerRevision).toHaveBeenCalledWith({ namespace: 'shop', limit: TIMELINE_LIST_LIMIT })
  })
  it('returns what it could read and flags a partial history', async () => {
    apps.listReplicaSetForAllNamespaces.mockRejectedValue(Object.assign(new Error('x'), { code: 403 }))
    core.listEventForAllNamespaces.mockResolvedValue({ items: [{ type: 'Normal', involvedObject: { kind: 'Pod', name: 'p' }, lastTimestamp: new Date('2026-01-01T00:00:00Z') }] })
    const r = await readClusterHistory(input)
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
    expect(r.value).toHaveLength(1)
  })
  it('fails when nothing can be read, and on a client build failure', async () => {
    for (const fn of [core.listEventForAllNamespaces, apps.listReplicaSetForAllNamespaces, apps.listControllerRevisionForAllNamespaces]) fn.mockRejectedValue(Object.assign(new Error('x'), { code: 401 }))
    expect(await readClusterHistory(input)).toEqual({ ok: false, errorCode: 'auth_failed' })
    buildOk = false
    expect(await readClusterHistory(input)).toEqual({ ok: false, errorCode: 'config' })
  })
})
