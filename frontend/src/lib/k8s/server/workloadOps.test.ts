import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@kubernetes/client-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kubernetes/client-node')>()
  return { ...actual, setHeaderOptions: vi.fn(actual.setHeaderOptions) }
})

const api = {
  patchNamespacedDeployment: vi.fn(),
  patchNamespacedStatefulSet: vi.fn(),
  patchNamespacedDaemonSet: vi.fn(),
  patchNamespacedDeploymentScale: vi.fn(),
  patchNamespacedStatefulSetScale: vi.fn(),
  readNamespacedDeployment: vi.fn(),
  listNamespacedReplicaSet: vi.fn(),
  deleteNamespacedPod: vi.fn(),
}
let buildOk = true
vi.mock('./client', () => ({
  buildKubeClient: () => (buildOk ? { ok: true, makeApiClient: () => api } : { ok: false }),
}))

import { PatchStrategy, setHeaderOptions } from '@kubernetes/client-node'
import {
  restartWorkload, scaleWorkload, listDeploymentRevisions, rollbackDeployment, deletePod,
  templateForRollback, projectRevision, RESTARTED_AT_ANNOTATION,
} from './workloadOps'

const input: any = { clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } }
const apiError = (code: number) => Object.assign(new Error('x'), { code })

const rs = (revision: number, image: string, uid = 'dep-uid') => ({
  metadata: {
    name: `web-${revision}`, creationTimestamp: new Date(`2026-01-0${revision}T00:00:00Z`),
    annotations: { 'deployment.kubernetes.io/revision': String(revision) },
    ownerReferences: [{ uid }],
  },
  spec: { template: { metadata: { labels: { app: 'web', 'pod-template-hash': `h${revision}` } }, spec: { containers: [{ name: 'c', image }] } } },
  status: { replicas: revision === 3 ? 2 : 0 },
})
const deployment = {
  metadata: { uid: 'dep-uid', annotations: { 'deployment.kubernetes.io/revision': '3' } },
  spec: { selector: { matchLabels: { app: 'web' } } },
}

beforeEach(() => {
  buildOk = true
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({})
  api.readNamespacedDeployment.mockResolvedValue(deployment)
  api.listNamespacedReplicaSet.mockResolvedValue({ items: [rs(1, 'web:1'), rs(3, 'web:3'), rs(2, 'web:2'), rs(9, 'other:9', 'other-uid')] })
  vi.mocked(setHeaderOptions).mockClear()
})

describe('restartWorkload', () => {
  it('stamps the restartedAt annotation on the pod template with a strategic merge patch', async () => {
    const now = new Date('2026-11-27T10:00:00Z')
    const r = await restartWorkload(input, 'deployment', 'shop', 'web', now)
    expect(r).toEqual({ ok: true, value: { restartedAt: '2026-11-27T10:00:00.000Z' } })
    const [req] = api.patchNamespacedDeployment.mock.calls[0]
    expect(req).toEqual({ name: 'web', namespace: 'shop', body: { spec: { template: { metadata: { annotations: { [RESTARTED_AT_ANNOTATION]: '2026-11-27T10:00:00.000Z' } } } } } })
    expect(setHeaderOptions).toHaveBeenCalledWith('Content-Type', PatchStrategy.StrategicMergePatch)
  })
  it('patches the StatefulSet and the DaemonSet through their own calls', async () => {
    await restartWorkload(input, 'statefulset', 'shop', 'db')
    await restartWorkload(input, 'daemonset', 'kube-system', 'agent')
    expect(api.patchNamespacedStatefulSet).toHaveBeenCalledTimes(1)
    expect(api.patchNamespacedDaemonSet).toHaveBeenCalledTimes(1)
  })
  it('maps an API refusal to its error code, and a client build failure to config', async () => {
    api.patchNamespacedDeployment.mockRejectedValue(apiError(403))
    expect(await restartWorkload(input, 'deployment', 'shop', 'web')).toEqual({ ok: false, errorCode: 'forbidden' })
    buildOk = false
    expect(await restartWorkload(input, 'deployment', 'shop', 'web')).toEqual({ ok: false, errorCode: 'config' })
  })
})

describe('scaleWorkload', () => {
  it('patches the scale subresource with a merge patch and returns the new count', async () => {
    api.patchNamespacedDeploymentScale.mockResolvedValue({ spec: { replicas: 5 } })
    expect(await scaleWorkload(input, 'deployment', 'shop', 'web', 5)).toEqual({ ok: true, value: { replicas: 5 } })
    expect(api.patchNamespacedDeploymentScale.mock.calls[0][0]).toEqual({ name: 'web', namespace: 'shop', body: { spec: { replicas: 5 } } })
    expect(setHeaderOptions).toHaveBeenCalledWith('Content-Type', PatchStrategy.MergePatch)
  })
  it('scales a StatefulSet to zero', async () => {
    expect(await scaleWorkload(input, 'statefulset', 'shop', 'db', 0)).toEqual({ ok: true, value: { replicas: 0 } })
    expect(api.patchNamespacedStatefulSetScale).toHaveBeenCalledTimes(1)
  })
  it('reports a missing workload as not_found', async () => {
    api.patchNamespacedDeploymentScale.mockRejectedValue(apiError(404))
    expect(await scaleWorkload(input, 'deployment', 'shop', 'web', 1)).toEqual({ ok: false, errorCode: 'not_found' })
  })
})

describe('listDeploymentRevisions', () => {
  it('lists the ReplicaSets the Deployment owns, newest first, and flags the current one', async () => {
    const r = await listDeploymentRevisions(input, 'shop', 'web')
    expect(api.listNamespacedReplicaSet).toHaveBeenCalledWith({ namespace: 'shop', labelSelector: 'app=web' })
    expect(r.value!.revisions.map(x => [x.revision, x.images[0], x.current])).toEqual([[3, 'web:3', true], [2, 'web:2', false], [1, 'web:1', false]])
  })
  it('projects a revision with its creation time and pod count', () => {
    expect(projectRevision(rs(3, 'web:3'), 3)).toEqual({ revision: 3, createdAt: '2026-01-03T00:00:00Z', images: ['web:3'], replicas: 2, current: true })
  })
})

describe('rollbackDeployment', () => {
  it('replaces the pod template with the one of the chosen revision, without the hash label', async () => {
    expect(await rollbackDeployment(input, 'shop', 'web', 2)).toEqual({ ok: true, value: { revision: 2 } })
    const [req] = api.patchNamespacedDeployment.mock.calls[0]
    expect(req.body).toEqual([{ op: 'replace', path: '/spec/template', value: { metadata: { labels: { app: 'web' } }, spec: { containers: [{ name: 'c', image: 'web:2' }] } } }])
    expect(setHeaderOptions).toHaveBeenCalledWith('Content-Type', PatchStrategy.JsonPatch)
  })
  it('refuses the current revision and an unknown or foreign one', async () => {
    expect(await rollbackDeployment(input, 'shop', 'web', 3)).toEqual({ ok: false, errorCode: 'conflict' })
    expect(await rollbackDeployment(input, 'shop', 'web', 9)).toEqual({ ok: false, errorCode: 'not_found' })
    expect(api.patchNamespacedDeployment).not.toHaveBeenCalled()
  })
  it('leaves the ReplicaSet it reads untouched', () => {
    const source = rs(1, 'web:1')
    templateForRollback(source)
    expect(source.spec.template.metadata.labels['pod-template-hash']).toBe('h1')
  })
})

describe('deletePod', () => {
  it('deletes the pod', async () => {
    expect(await deletePod(input, 'shop', 'web-1')).toEqual({ ok: true, value: { deleted: true } })
    expect(api.deleteNamespacedPod).toHaveBeenCalledWith({ name: 'web-1', namespace: 'shop' })
  })
  it('reports a conflict', async () => {
    api.deleteNamespacedPod.mockRejectedValue(apiError(409))
    expect(await deletePod(input, 'shop', 'web-1')).toEqual({ ok: false, errorCode: 'conflict' })
  })
})
