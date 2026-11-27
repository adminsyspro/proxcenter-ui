import { describe, it, expect } from 'vitest'
import { resolveWorkloadGraph } from './topologyWorkload'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function pod(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: 'pod-1', namespace: 'default', uid: 'pod-uid-1', ownerReferences: [] },
    spec: { nodeName: 'node-1', containers: [{ name: 'app' }], initContainers: [], ephemeralContainers: [] },
    status: { phase: 'Running', containerStatuses: [{ ready: true, state: {} }] },
    ...overrides,
  }
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: 'web', namespace: 'default', uid: 'deploy-uid-1', labels: { 'app.kubernetes.io/name': 'web' } },
    spec: { selector: { matchLabels: { app: 'web' } } },
    ...overrides,
  }
}

function replicaSet(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      name: 'web-rs-1',
      namespace: 'default',
      uid: 'rs-uid-1',
      ownerReferences: [{ kind: 'Deployment', apiVersion: 'apps/v1', uid: 'deploy-uid-1', controller: true, name: 'web' }],
      labels: { 'app.kubernetes.io/name': 'web' },
    },
    ...overrides,
  }
}

function makePodWithOwner(uid: string, ownerUid: string, ownerKind: string, ns = 'default') {
  return pod({
    metadata: {
      name: `pod-${uid}`,
      namespace: ns,
      uid,
      ownerReferences: [{ kind: ownerKind, apiVersion: 'apps/v1', uid: ownerUid, controller: true, name: ownerKind.toLowerCase() }],
    },
    spec: { nodeName: 'node-1', containers: [{ name: 'app' }], initContainers: [], ephemeralContainers: [] },
  })
}

/** Full WorkloadInput with sane empty defaults; pass only the fields under test. */
function baseInput(overrides: Partial<Parameters<typeof resolveWorkloadGraph>[0]> = {}) {
  return {
    namespaceMode: 'single' as const,
    namespace: 'default',
    pods: [],
    services: [],
    ingresses: [],
    deployments: [],
    statefulsets: [],
    daemonsets: [],
    jobs: [],
    cronjobs: [],
    replicasets: [],
    configmaps: [],
    cappedKinds: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 4.1 Owner resolution: RS hop collapse
// ---------------------------------------------------------------------------

describe('4.1 owner resolution', () => {
  it('Pod->ReplicaSet->Deployment collapses to the Deployment pod group', () => {
    const deploy = deployment()
    const rs = replicaSet()
    const pods = [
      makePodWithOwner('pod-a', 'rs-uid-1', 'ReplicaSet'),
      makePodWithOwner('pod-b', 'rs-uid-1', 'ReplicaSet'),
      makePodWithOwner('pod-c', 'rs-uid-1', 'ReplicaSet'),
    ]
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods,
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs],
      configmaps: [],
      cappedKinds: {},
    })

    const pg = g.resources.find(r => r.kind === 'podGroup' && r.detailRef?.kind === 'deployment')
    expect(pg).toBeDefined()
    expect(pg?.detailRef?.name).toBe('web')
    expect(pg?.podCount).toBe(3)
    // No separate replicaset node (RS with Deployment owner is NOT synthetic)
    expect(g.resources.some(r => r.kind === 'replicaset')).toBe(false)
  })

  it('orphan ReplicaSet (no Deployment owner) with pods becomes a synthetic replicaset node', () => {
    const orphanRs = {
      metadata: {
        name: 'orphan-rs',
        namespace: 'default',
        uid: 'orphan-rs-uid',
        ownerReferences: [],
        labels: { app: 'orphan' },
      },
    }
    const pods = [makePodWithOwner('pod-x', 'orphan-rs-uid', 'ReplicaSet')]
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods,
      services: [],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [orphanRs],
      configmaps: [],
      cappedKinds: {},
    })

    const synth = g.resources.find(r => r.kind === 'replicaset')
    expect(synth).toBeDefined()
    expect(synth?.synthetic).toBe(true)
    const pg = g.resources.find(r => r.kind === 'podGroup')
    expect(pg).toBeDefined()
    expect(pg?.podCount).toBe(1)
  })

  it('orphan pod (no controller owner) stays as a pod node', () => {
    const orphanPod = pod({ metadata: { name: 'standalone', namespace: 'default', uid: 'pod-standalone', ownerReferences: [] } })
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [orphanPod],
      services: [],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    expect(g.resources.some(r => r.kind === 'pod' && r.name === 'standalone')).toBe(true)
    expect(g.resources.some(r => r.kind === 'podGroup')).toBe(false)
  })

  it('Pod->StatefulSet attributes pod to StatefulSet podGroup', () => {
    const sts = {
      metadata: { name: 'db', namespace: 'default', uid: 'sts-uid-1', labels: { app: 'db' } },
      spec: { selector: { matchLabels: { app: 'db' } } },
    }
    const pods = [makePodWithOwner('pod-sts-1', 'sts-uid-1', 'StatefulSet')]
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods,
      services: [],
      ingresses: [],
      deployments: [],
      statefulsets: [sts],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const pg = g.resources.find(r => r.kind === 'podGroup')
    expect(pg?.detailRef?.kind).toBe('statefulset')
    expect(pg?.detailRef?.name).toBe('db')
  })
})

// ---------------------------------------------------------------------------
// 4.2 Service edges
// ---------------------------------------------------------------------------

describe('4.2 service edges', () => {
  it('selectorless service produces no selects edges', () => {
    const svc = {
      metadata: { name: 'headless', namespace: 'default', uid: 'svc-uid-1', labels: {} },
      spec: {},
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [svc],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    expect(g.edges.filter(e => e.rel === 'selects')).toHaveLength(0)
  })

  it('service selector matches ALL labels and is namespace-local', () => {
    const deploy = deployment()
    const rs = replicaSet()
    const matchedPod = {
      ...makePodWithOwner('pod-matched', 'rs-uid-1', 'ReplicaSet'),
      metadata: {
        name: 'pod-matched',
        namespace: 'default',
        uid: 'pod-matched',
        ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-1', controller: true, name: 'web-rs-1' }],
        labels: { app: 'web', tier: 'frontend' },
      },
    }
    const wrongNsPod = {
      ...makePodWithOwner('pod-other-ns', 'rs-uid-1', 'ReplicaSet', 'other'),
      metadata: {
        name: 'pod-other-ns',
        namespace: 'other',
        uid: 'pod-other-ns',
        ownerReferences: [],
        labels: { app: 'web', tier: 'frontend' },
      },
    }
    const svc = {
      metadata: { name: 'web-svc', namespace: 'default', uid: 'svc-uid-1', labels: {} },
      spec: { selector: { app: 'web', tier: 'frontend' } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [matchedPod, wrongNsPod],
      services: [svc],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs],
      configmaps: [],
      cappedKinds: {},
    })

    const selectsEdges = g.edges.filter(e => e.rel === 'selects')
    // Should link service to deployment workload (via pod match)
    expect(selectsEdges.length).toBeGreaterThanOrEqual(1)
    // Should NOT link to wrong-ns pod
    const svcId = 'default/svc/web-svc'
    const otherNsId = 'other/pod/pod-other-ns'
    expect(selectsEdges.some(e => e.source === svcId && e.target === otherNsId)).toBe(false)
  })

  it('service whose matched pods span multiple workloads gets edges to each', () => {
    const deploy1 = deployment()
    const rs1 = replicaSet()
    const deploy2 = {
      metadata: { name: 'api', namespace: 'default', uid: 'deploy-uid-2', labels: { app: 'api' } },
      spec: { selector: { matchLabels: { role: 'backend' } } },
    }
    const rs2 = {
      metadata: {
        name: 'api-rs',
        namespace: 'default',
        uid: 'rs-uid-2',
        ownerReferences: [{ kind: 'Deployment', apiVersion: 'apps/v1', uid: 'deploy-uid-2', controller: true, name: 'api' }],
        labels: { app: 'api' },
      },
    }
    const pod1 = {
      ...makePodWithOwner('pod-w1', 'rs-uid-1', 'ReplicaSet'),
      metadata: { name: 'pod-w1', namespace: 'default', uid: 'pod-w1', ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-1', controller: true, name: 'web-rs-1' }], labels: { role: 'frontend' } },
    }
    const pod2 = {
      ...makePodWithOwner('pod-w2', 'rs-uid-2', 'ReplicaSet'),
      metadata: { name: 'pod-w2', namespace: 'default', uid: 'pod-w2', ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-2', controller: true, name: 'api-rs' }], labels: { role: 'frontend' } },
    }
    const svc = {
      metadata: { name: 'mix-svc', namespace: 'default', uid: 'svc-mix', labels: {} },
      spec: { selector: { role: 'frontend' } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [pod1, pod2],
      services: [svc],
      ingresses: [],
      deployments: [deploy1, deploy2],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs1, rs2],
      configmaps: [],
      cappedKinds: {},
    })

    const selectsEdges = g.edges.filter(e => e.rel === 'selects')
    expect(selectsEdges.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 4.2 Ingress edges
// ---------------------------------------------------------------------------

describe('4.2 ingress edges', () => {
  it('ingress routes via rules + defaultBackend, ignores resource backend', () => {
    const svc1 = {
      metadata: { name: 'web-svc', namespace: 'default', uid: 'svc-1', labels: {} },
      spec: { selector: { app: 'web' } },
    }
    const svc2 = {
      metadata: { name: 'default-svc', namespace: 'default', uid: 'svc-2', labels: {} },
      spec: { selector: { app: 'web2' } },
    }
    const ingress = {
      metadata: { name: 'main-ingress', namespace: 'default', uid: 'ing-1', labels: {} },
      spec: {
        defaultBackend: { service: { name: 'default-svc', port: { number: 80 } } },
        rules: [
          {
            http: {
              paths: [
                { backend: { service: { name: 'web-svc', port: { number: 80 } } } },
                { backend: { resource: { kind: 'StorageBucket', name: 'ignored' } } },
              ],
            },
          },
          { http: null },
        ],
      },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [svc1, svc2],
      ingresses: [ingress],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const routeEdges = g.edges.filter(e => e.rel === 'routes')
    const targets = routeEdges.map(e => e.target)
    // Should route to web-svc and default-svc; NOT to resource backend
    expect(targets.some(t => t.includes('web-svc'))).toBe(true)
    expect(targets.some(t => t.includes('default-svc'))).toBe(true)
    expect(routeEdges).toHaveLength(2)
  })

  it('ingress with nil http paths does not throw', () => {
    const ingress = {
      metadata: { name: 'empty-ing', namespace: 'default', uid: 'ing-empty', labels: {} },
      spec: { rules: [{ http: undefined }] },
    }
    expect(() =>
      resolveWorkloadGraph({
        namespaceMode: 'single',
        namespace: 'default',
        pods: [],
        services: [],
        ingresses: [ingress],
        deployments: [],
        statefulsets: [],
        daemonsets: [],
        jobs: [],
        cronjobs: [],
        replicasets: [],
        configmaps: [],
        cappedKinds: {},
      })
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 4.2 ConfigMap edges
// ---------------------------------------------------------------------------

describe('4.2 configmap edges', () => {
  it('configmap ref from projected volume + initContainer + envFrom in pod template', () => {
    const deploy = {
      metadata: { name: 'app', namespace: 'default', uid: 'deploy-app', labels: { app: 'app' } },
      spec: {
        template: {
          spec: {
            volumes: [
              { projected: { sources: [{ configMap: { name: 'proj-cm' } }] } },
            ],
            containers: [],
            initContainers: [
              {
                name: 'init',
                envFrom: [{ configMapRef: { name: 'init-cm' } }],
                env: [],
              },
            ],
            ephemeralContainers: [],
          },
        },
      },
    }
    const cm1 = { metadata: { name: 'proj-cm', namespace: 'default', uid: 'cm-proj' }, data: { key1: 'v', key2: 'v' } }
    const cm2 = { metadata: { name: 'init-cm', namespace: 'default', uid: 'cm-init' }, data: { k: 'v' } }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [cm1, cm2],
      cappedKinds: {},
    })

    const configureEdges = g.edges.filter(e => e.rel === 'configures')
    expect(configureEdges.length).toBeGreaterThanOrEqual(2)

    // subline for cm1 = '2 keys' (key count, never key names/values)
    const cm1Resource = g.resources.find(r => r.kind === 'configmap' && r.name === 'proj-cm')
    expect(cm1Resource?.subline).toBe('2 keys')
    const cm2Resource = g.resources.find(r => r.kind === 'configmap' && r.name === 'init-cm')
    expect(cm2Resource?.subline).toBe('1 key')
  })

  it('configmap ref from CronJob jobTemplate', () => {
    const cj = {
      metadata: { name: 'cron-job', namespace: 'default', uid: 'cj-uid', labels: { app: 'cron' } },
      spec: {
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: 'worker',
                    env: [{ name: 'KEY', valueFrom: { configMapKeyRef: { name: 'cron-cm', key: 'K' } } }],
                    envFrom: [],
                  },
                ],
                initContainers: [],
                ephemeralContainers: [],
                volumes: [],
              },
            },
          },
        },
      },
    }
    const cm = { metadata: { name: 'cron-cm', namespace: 'default', uid: 'cm-cron' }, data: { K: 'v', L: 'v2' } }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [cj],
      replicasets: [],
      configmaps: [cm],
      cappedKinds: {},
    })

    const configureEdges = g.edges.filter(e => e.rel === 'configures')
    expect(configureEdges.some(e => e.target.includes('cron-job'))).toBe(true)
    const cmRes = g.resources.find(r => r.kind === 'configmap' && r.name === 'cron-cm')
    expect(cmRes?.subline).toBe('2 keys')
  })

  it('env valueFrom configMapKeyRef in regular container is detected', () => {
    const deploy = {
      metadata: { name: 'myapp', namespace: 'default', uid: 'deploy-myapp', labels: { app: 'myapp' } },
      spec: {
        template: {
          spec: {
            volumes: [],
            containers: [
              {
                name: 'main',
                env: [{ name: 'DB_HOST', valueFrom: { configMapKeyRef: { name: 'app-config', key: 'DB_HOST' } } }],
                envFrom: [],
              },
            ],
            initContainers: [],
            ephemeralContainers: [],
          },
        },
      },
    }
    const cm = { metadata: { name: 'app-config', namespace: 'default', uid: 'cm-app' }, data: { DB_HOST: 'localhost' } }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [cm],
      cappedKinds: {},
    })

    const configureEdges = g.edges.filter(e => e.rel === 'configures')
    expect(configureEdges.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 4.3 Pod groups + health
// ---------------------------------------------------------------------------

describe('4.3 pod health', () => {
  it('Succeeded Job pods count as healthy, reports completed/failed/active', () => {
    const job = {
      metadata: { name: 'batch-job', namespace: 'default', uid: 'job-uid-1', labels: { app: 'batch' } },
      spec: {
        template: { spec: { containers: [], initContainers: [], ephemeralContainers: [], volumes: [] } },
      },
      status: { succeeded: 2, failed: 1, active: 0 },
    }
    const succeededPod = {
      metadata: {
        name: 'batch-pod-1',
        namespace: 'default',
        uid: 'batch-pod-1',
        ownerReferences: [{ kind: 'Job', apiVersion: 'batch/v1', uid: 'job-uid-1', controller: true, name: 'batch-job' }],
      },
      spec: { nodeName: 'node-1', containers: [], initContainers: [], ephemeralContainers: [] },
      status: { phase: 'Succeeded', containerStatuses: [] },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [succeededPod],
      services: [],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [job],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const pg = g.resources.find(r => r.kind === 'podGroup' && r.detailRef?.kind === 'job')
    expect(pg).toBeDefined()
    expect(pg?.healthyCount).toBeGreaterThanOrEqual(1)
    expect(pg?.completed).toBeDefined()
  })

  it('CronJob shows active jobs + latest completed job, caps historical', () => {
    const cj = {
      metadata: { name: 'my-cron', namespace: 'default', uid: 'cj-uid-1', labels: { app: 'cron' } },
      spec: {
        jobTemplate: {
          spec: {
            template: { spec: { containers: [], initContainers: [], ephemeralContainers: [], volumes: [] } },
          },
        },
      },
      status: {
        active: [{ name: 'my-cron-active', namespace: 'default', uid: 'job-active' }],
      },
    }
    const activeJob = {
      metadata: {
        name: 'my-cron-active',
        namespace: 'default',
        uid: 'job-active',
        ownerReferences: [{ kind: 'CronJob', apiVersion: 'batch/v1', uid: 'cj-uid-1', controller: true, name: 'my-cron' }],
        labels: { app: 'cron' },
        creationTimestamp: '2026-06-30T10:00:00Z',
      },
      status: { succeeded: 0, failed: 0, active: 1 },
    }
    const completedJob1 = {
      metadata: {
        name: 'my-cron-done-1',
        namespace: 'default',
        uid: 'job-done-1',
        ownerReferences: [{ kind: 'CronJob', apiVersion: 'batch/v1', uid: 'cj-uid-1', controller: true, name: 'my-cron' }],
        labels: { app: 'cron' },
        creationTimestamp: '2026-06-30T09:00:00Z',
      },
      status: { succeeded: 1, failed: 0, active: 0, completionTime: '2026-06-30T09:05:00Z' },
    }
    const completedJob2 = {
      metadata: {
        name: 'my-cron-done-2',
        namespace: 'default',
        uid: 'job-done-2',
        ownerReferences: [{ kind: 'CronJob', apiVersion: 'batch/v1', uid: 'cj-uid-1', controller: true, name: 'my-cron' }],
        labels: { app: 'cron' },
        creationTimestamp: '2026-06-29T09:00:00Z',
      },
      status: { succeeded: 1, failed: 0, active: 0, completionTime: '2026-06-29T09:05:00Z' },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [activeJob, completedJob1, completedJob2],
      cronjobs: [cj],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const cjRes = g.resources.find(r => r.kind === 'cronjob')
    expect(cjRes).toBeDefined()
    // Active job should appear
    const activeJobRes = g.resources.find(r => r.kind === 'job' && r.name === 'my-cron-active')
    expect(activeJobRes).toBeDefined()
    // Latest completed job should appear
    const latestDone = g.resources.find(r => r.kind === 'job' && r.name === 'my-cron-done-1')
    expect(latestDone).toBeDefined()
    // Older completed job should be capped (not surfaced as a node)
    const olderDone = g.resources.find(r => r.kind === 'job' && r.name === 'my-cron-done-2')
    expect(olderDone).toBeUndefined()
  })

  it('sorts completed jobs when creationTimestamp is a Date (client-node deserialization)', () => {
    // @kubernetes/client-node returns creationTimestamp as a Date, not a string.
    // The old sort called Date.localeCompare and threw
    // "bTs.localeCompare is not a function", surfacing as a topology 500.
    const cj = {
      metadata: { name: 'my-cron', namespace: 'default', uid: 'cj-uid-1', labels: { app: 'cron' } },
      spec: { jobTemplate: { spec: { template: { spec: { containers: [], initContainers: [], ephemeralContainers: [], volumes: [] } } } } },
      status: {},
    }
    const mkJob = (name: string, uid: string, created: Date) => ({
      metadata: {
        name, namespace: 'default', uid,
        ownerReferences: [{ kind: 'CronJob', apiVersion: 'batch/v1', uid: 'cj-uid-1', controller: true, name: 'my-cron' }],
        labels: { app: 'cron' },
        creationTimestamp: created,
      },
      status: { succeeded: 1, failed: 0, active: 0, completionTime: new Date(created.getTime() + 300000) },
    })
    const newer = mkJob('my-cron-done-new', 'job-done-new', new Date('2026-06-30T09:00:00Z'))
    const older = mkJob('my-cron-done-old', 'job-done-old', new Date('2026-06-29T09:00:00Z'))

    let g!: ReturnType<typeof resolveWorkloadGraph>
    expect(() => {
      g = resolveWorkloadGraph({
        namespaceMode: 'single', namespace: 'default',
        pods: [], services: [], ingresses: [], deployments: [], statefulsets: [],
        daemonsets: [], jobs: [older, newer], cronjobs: [cj], replicasets: [], configmaps: [],
        cappedKinds: {},
      })
    }).not.toThrow()

    // Newest completed job is surfaced; the older one is capped.
    expect(g.resources.find(r => r.kind === 'job' && r.name === 'my-cron-done-new')).toBeDefined()
    expect(g.resources.find(r => r.kind === 'job' && r.name === 'my-cron-done-old')).toBeUndefined()
  })

  it('red-tints pod group with CrashLoopBackOff pod', () => {
    const deploy = deployment()
    const rs = replicaSet()
    const crashPod = {
      metadata: {
        name: 'crash-pod',
        namespace: 'default',
        uid: 'crash-pod-uid',
        ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-1', controller: true, name: 'web-rs-1' }],
        labels: {},
      },
      spec: { nodeName: 'node-1', containers: [{ name: 'app' }], initContainers: [], ephemeralContainers: [] },
      status: {
        phase: 'Running',
        containerStatuses: [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } } }],
      },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [crashPod],
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs],
      configmaps: [],
      cappedKinds: {},
    })

    const pg = g.resources.find(r => r.kind === 'podGroup')
    expect(pg?.healthy).toBe(false)
    expect(pg?.reason).toBe('CrashLoopBackOff')
  })
})

// ---------------------------------------------------------------------------
// 4.4 Grouping with inheritance
// ---------------------------------------------------------------------------

describe('4.4 grouping', () => {
  it('prefers app.kubernetes.io/name over app label', () => {
    const deploy = {
      metadata: { name: 'myapp', namespace: 'default', uid: 'deploy-myapp', labels: { 'app.kubernetes.io/name': 'preferred', app: 'fallback' } },
      spec: { selector: { matchLabels: {} } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const workload = g.resources.find(r => r.kind === 'deployment')
    expect(workload?.groupKey).toBe('preferred')
    expect(g.groups.some(gr => gr.key === 'preferred')).toBe(true)
  })

  it('label-less service inherits group from the workload it selects', () => {
    const deploy = deployment()
    const rs = replicaSet()
    const pod1 = {
      ...makePodWithOwner('pod-sel', 'rs-uid-1', 'ReplicaSet'),
      metadata: {
        name: 'pod-sel',
        namespace: 'default',
        uid: 'pod-sel',
        ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-1', controller: true, name: 'web-rs-1' }],
        labels: { app: 'web' },
      },
    }
    const svc = {
      metadata: { name: 'web-svc', namespace: 'default', uid: 'svc-inherit', labels: {} },
      spec: { selector: { app: 'web' } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [pod1],
      services: [svc],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs],
      configmaps: [],
      cappedKinds: {},
    })

    const svcRes = g.resources.find(r => r.kind === 'service' && r.name === 'web-svc')
    expect(svcRes?.groupKey).toBe('web')
  })

  it('ambiguous group inheritance -> shared bucket + crossGroup edges', () => {
    const deploy1 = deployment()
    const rs1 = replicaSet()
    const deploy2 = {
      metadata: { name: 'api', namespace: 'default', uid: 'deploy-api', labels: { 'app.kubernetes.io/name': 'api' } },
      spec: { selector: { matchLabels: { app: 'api' } } },
    }
    const rs2 = {
      metadata: {
        name: 'api-rs',
        namespace: 'default',
        uid: 'rs-uid-2',
        ownerReferences: [{ kind: 'Deployment', apiVersion: 'apps/v1', uid: 'deploy-api', controller: true, name: 'api' }],
        labels: { 'app.kubernetes.io/name': 'api' },
      },
    }
    // pod for web
    const webPod = {
      metadata: {
        name: 'web-pod',
        namespace: 'default',
        uid: 'web-pod',
        ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-1', controller: true, name: 'web-rs-1' }],
        labels: { role: 'mix' },
      },
      spec: { nodeName: 'node-1', containers: [], initContainers: [], ephemeralContainers: [] },
      status: { phase: 'Running', containerStatuses: [] },
    }
    // pod for api
    const apiPod = {
      metadata: {
        name: 'api-pod',
        namespace: 'default',
        uid: 'api-pod',
        ownerReferences: [{ kind: 'ReplicaSet', apiVersion: 'apps/v1', uid: 'rs-uid-2', controller: true, name: 'api-rs' }],
        labels: { role: 'mix' },
      },
      spec: { nodeName: 'node-1', containers: [], initContainers: [], ephemeralContainers: [] },
      status: { phase: 'Running', containerStatuses: [] },
    }
    // service that selects BOTH groups
    const sharedSvc = {
      metadata: { name: 'shared-svc', namespace: 'default', uid: 'svc-shared', labels: {} },
      spec: { selector: { role: 'mix' } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [webPod, apiPod],
      services: [sharedSvc],
      ingresses: [],
      deployments: [deploy1, deploy2],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs1, rs2],
      configmaps: [],
      cappedKinds: {},
    })

    const svcRes = g.resources.find(r => r.kind === 'service' && r.name === 'shared-svc')
    expect(svcRes?.groupKey).toBe('shared')
    expect(g.groups.some(gr => gr.key === 'shared' && gr.shared === true)).toBe(true)

    const crossEdges = g.edges.filter(e => e.crossGroup === true)
    expect(crossEdges.length).toBeGreaterThanOrEqual(1)
  })

  it('resource with neither label nor relation falls to ungrouped', () => {
    const svc = {
      metadata: { name: 'mystery-svc', namespace: 'default', uid: 'svc-mystery', labels: {} },
      spec: {},
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [svc],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const svcRes = g.resources.find(r => r.kind === 'service' && r.name === 'mystery-svc')
    expect(svcRes?.groupKey).toBe('ungrouped')
  })
})

// ---------------------------------------------------------------------------
// 4.x app grouping (label chain + workload fallback)
// ---------------------------------------------------------------------------

describe('4.x app grouping (label chain + workload fallback)', () => {
  it('prefers app.kubernetes.io/instance over name over app', () => {
    const d = deployment()
    ;(d.metadata as any).labels = {
      'app.kubernetes.io/instance': 'inst',
      'app.kubernetes.io/name': 'nm',
      app: 'legacy',
    }
    const g = resolveWorkloadGraph(baseInput({ deployments: [d] }))
    const res = g.resources.find(r => r.kind === 'deployment')!
    const grp = g.groups.find(x => x.key === res.groupKey)!
    expect(grp.label).toBe('inst')
  })

  it('unlabeled workload becomes its own tile labeled by workload name', () => {
    const d = deployment() // name "web" per factory
    ;(d.metadata as any).labels = {}
    const g = resolveWorkloadGraph(baseInput({ deployments: [d] }))
    const res = g.resources.find(r => r.kind === 'deployment')!
    expect(res.groupKey).not.toBe('ungrouped')
    const grp = g.groups.find(x => x.key === res.groupKey)!
    expect(grp.label).toBe('web') // the deployment's metadata.name
    expect(grp.namespace).toBe('default')
  })
})

// ---------------------------------------------------------------------------
// 4.5 Namespace + IDs
// ---------------------------------------------------------------------------

describe('4.5 namespace + IDs', () => {
  it('single-ns mode produces namespace-qualified IDs', () => {
    const deploy = deployment()
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const res = g.resources.find(r => r.kind === 'deployment')
    expect(res?.id).toMatch(/^default\//)
  })

  it('all-namespaces uses <ns>/<app> group keys and does not merge same-named apps across ns', () => {
    const deployA = {
      metadata: { name: 'app', namespace: 'ns-a', uid: 'deploy-a', labels: { 'app.kubernetes.io/name': 'app' } },
      spec: { selector: { matchLabels: {} } },
    }
    const deployB = {
      metadata: { name: 'app', namespace: 'ns-b', uid: 'deploy-b', labels: { 'app.kubernetes.io/name': 'app' } },
      spec: { selector: { matchLabels: {} } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'all',
      namespace: null,
      pods: [],
      services: [],
      ingresses: [],
      deployments: [deployA, deployB],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: {},
    })

    const groupKeys = g.groups.map(gr => gr.key)
    expect(groupKeys).toContain('ns-a/app')
    expect(groupKeys).toContain('ns-b/app')

    // IDs must be namespace-qualified
    const resA = g.resources.find(r => r.uid === 'deploy-a')
    expect(resA?.id).toMatch(/^ns-a\//)
    const resB = g.resources.find(r => r.uid === 'deploy-b')
    expect(resB?.id).toMatch(/^ns-b\//)
  })
})

// ---------------------------------------------------------------------------
// 4.6 Completeness
// ---------------------------------------------------------------------------

describe('4.6 completeness', () => {
  it('capped pods mark the pod group incomplete', () => {
    const deploy = deployment()
    const rs = replicaSet()
    const pods = [makePodWithOwner('pod-cap', 'rs-uid-1', 'ReplicaSet')]
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods,
      services: [],
      ingresses: [],
      deployments: [deploy],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [rs],
      configmaps: [],
      cappedKinds: { pods: true },
    })

    const pg = g.resources.find(r => r.kind === 'podGroup')
    expect(pg?.incomplete).toBe(true)
  })

  it('capped services mark the service resource incomplete', () => {
    const svc = {
      metadata: { name: 'svc-capped', namespace: 'default', uid: 'svc-c', labels: {} },
      spec: { selector: { app: 'svc-capped' } },
    }
    const g = resolveWorkloadGraph({
      namespaceMode: 'single',
      namespace: 'default',
      pods: [],
      services: [svc],
      ingresses: [],
      deployments: [],
      statefulsets: [],
      daemonsets: [],
      jobs: [],
      cronjobs: [],
      replicasets: [],
      configmaps: [],
      cappedKinds: { services: true },
    })

    const svcRes = g.resources.find(r => r.kind === 'service')
    expect(svcRes?.incomplete).toBe(true)
  })
})
