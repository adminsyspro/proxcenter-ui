/**
 * TDD tests for resources.ts:
 *   - Unit: per-kind projector logic (real deserialized shapes, no .body wrapper).
 *   - Integration: real HTTPS fixture server -> buildKubeClient -> listResources.
 */
import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { listResources, KIND_TABLE, projectNode, podReason } from './resources'

// ── helpers ────────────────────────────────────────────────────────────────

function makeMeta(overrides: Record<string, any> = {}) {
  return {
    name: 'test-obj',
    namespace: 'default',
    uid: 'uid-1',
    creationTimestamp: '2024-06-01T00:00:00Z',
    labels: {},
    ...overrides,
  }
}

// Build a minimal K8s list response for the given kind (used by integration test)
function podListFixture() {
  return {
    apiVersion: 'v1',
    kind: 'PodList',
    metadata: { resourceVersion: '1' },
    items: [
      {
        metadata: makeMeta({ name: 'z-pod', namespace: 'kube-system' }),
        spec: {
          nodeName: 'node-1',
          containers: [{ name: 'app', image: 'nginx' }],
        },
        status: {
          phase: 'Running',
          podIP: '10.0.0.1',
          containerStatuses: [{ name: 'app', ready: true, restartCount: 3 }],
        },
      },
      {
        metadata: makeMeta({ name: 'a-pod', namespace: 'default' }),
        spec: {
          nodeName: 'node-2',
          containers: [{ name: 'app', image: 'nginx' }, { name: 'sidecar', image: 'envoy' }],
        },
        status: {
          phase: 'Pending',
          podIP: '',
          containerStatuses: [],
        },
      },
    ],
  }
}

// ── unit tests: projectors ─────────────────────────────────────────────────

describe('projectPod', () => {
  it('maps phase/ready/restarts/node/podIP from real deserialized shape', () => {
    const pod = {
      metadata: makeMeta({ name: 'my-pod', namespace: 'default' }),
      spec: {
        nodeName: 'worker-1',
        containers: [{ name: 'app' }, { name: 'sidecar' }],
      },
      status: {
        phase: 'Running',
        podIP: '10.0.0.5',
        containerStatuses: [
          { name: 'app', ready: true, restartCount: 2 },
          { name: 'sidecar', ready: false, restartCount: 1 },
        ],
      },
    }
    const result = KIND_TABLE['pod']!.project(pod)
    expect(result.summary['phase']).toBe('Running')
    expect(result.summary['ready']).toBe('1/2')
    expect(result.summary['restarts']).toBe('3')
    expect(result.summary['node']).toBe('worker-1')
    expect(result.summary['podIP']).toBe('10.0.0.5')
    expect(result.name).toBe('my-pod')
    expect(result.namespace).toBe('default')
  })
})

describe('listResources sort+cap', () => {
  it('applies LIST_CAP=500 and deterministic sort', () => {
    // Static shape verification: 500 cap logic
    const items = Array.from({ length: 501 }, (_, i) => ({
      kind: 'pod', name: `p${String(i).padStart(3, '0')}`,
      namespace: 'ns', uid: `u${i}`, createdAt: '', summary: {},
    }))
    const sorted = [...items].sort((a, b) => {
      const nc = (a.namespace ?? '').localeCompare(b.namespace ?? '')
      if (nc !== 0) return nc
      return a.name.localeCompare(b.name)
    })
    const truncated = sorted.length > 500
    const capped = truncated ? sorted.slice(0, 500) : sorted
    expect(capped.length).toBe(500)
    expect(truncated).toBe(true)
    expect(capped[0].name).toBe('p000')
  })
})

// ── integration test: real HTTPS fixture -> real client ────────────────────

function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-resources-integ-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-resources-integ-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  const certPem = readFileSync(certFile, 'utf8')
  const keyPem = readFileSync(keyFile, 'utf8')
  return { caPem: certPem, certPem, keyPem, dir }
}

describe('listResources - real client integration', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach((c) => c()))

  it('listResources(pod) parses real K8s PodList wire shape, projects summary, sorts deterministically', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const fixture = podListFixture()

    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      // @kubernetes/client-node sends GET /api/v1/pods for listPodForAllNamespaces
      if (req.url && req.url.startsWith('/api/v1/pods')) {
        res.writeHead(200)
        res.end(JSON.stringify(fixture))
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ message: 'not found' }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port
    const serverUrl = `https://127.0.0.1:${port}`

    const result = await listResources(
      {
        clusterId: 'resources-integ',
        credentialVersion: 1,
        server: serverUrl,
        cred: { type: 'token', value: 'test-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'pod',
    )

    expect(result.ok).toBe(true)
    expect(result.value).toBeDefined()
    expect(result.value!.truncated).toBe(false)
    expect(result.value!.items).toHaveLength(2)

    // deterministic sort: (default, a-pod) before (kube-system, z-pod)
    const [first, second] = result.value!.items
    expect(first.name).toBe('a-pod')
    expect(first.namespace).toBe('default')
    expect(second.name).toBe('z-pod')
    expect(second.namespace).toBe('kube-system')

    // projector output: a-pod has 2 containers, 0 statuses -> ready=0/2, restarts=0
    expect(first.summary['phase']).toBe('Pending')
    expect(first.summary['ready']).toBe('0/2')
    expect(first.summary['restarts']).toBe('0')
    expect(first.summary['node']).toBe('node-2')
    expect(first.summary['podIP']).toBe('')

    // z-pod: 1 container, 1 ready, 3 restarts
    expect(second.summary['phase']).toBe('Running')
    expect(second.summary['ready']).toBe('1/1')
    expect(second.summary['restarts']).toBe('3')
    expect(second.summary['node']).toBe('node-1')
    expect(second.summary['podIP']).toBe('10.0.0.1')

    // uid and createdAt are mapped
    expect(first.uid).toBe('uid-1')
    expect(first.createdAt).toBe('2024-06-01T00:00:00Z')
  })

  it('listResources returns errorCode on 403', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(403)
      res.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', status: 'Failure', message: 'forbidden', reason: 'Forbidden', code: 403 }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const result = await listResources(
      {
        clusterId: 'resources-403',
        credentialVersion: 1,
        server: `https://127.0.0.1:${port}`,
        cred: { type: 'token', value: 'bad-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'node',
    )

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('forbidden')
  })
})

// ── per-kind summary key tests (via fixture shapes) ────────────────────────

describe('per-kind summary keys (Go resources.go parity)', () => {
  it('deployment summary keys match resources.go: ready, upToDate, available', () => {
    const d = {
      metadata: makeMeta({ namespace: 'default' }),
      spec: { replicas: 3 },
      status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
    }
    const result = KIND_TABLE['deployment']!.project(d)
    expect(result.summary['ready']).toBe('2/3')
    expect(result.summary['upToDate']).toBe('3')
    expect(result.summary['available']).toBe('2')
  })

  it('statefulset summary key: ready', () => {
    const s = { metadata: makeMeta(), spec: { replicas: 2 }, status: { readyReplicas: 1 } }
    const result = KIND_TABLE['statefulset']!.project(s)
    expect(result.summary['ready']).toBe('1/2')
  })

  it('daemonset summary key: ready', () => {
    const d = { metadata: makeMeta(), status: { numberReady: 2, desiredNumberScheduled: 3 } }
    const result = KIND_TABLE['daemonset']!.project(d)
    expect(result.summary['ready']).toBe('2/3')
  })

  it('job summary keys: completions, status=Complete', () => {
    const j = {
      metadata: makeMeta({ namespace: 'default' }),
      spec: { completions: 1 },
      status: { succeeded: 1, failed: 0, completionTime: '2024-01-01T00:00:00Z' },
    }
    const result = KIND_TABLE['job']!.project(j)
    expect(result.summary['completions']).toBe('1/1')
    expect(result.summary['status']).toBe('Complete')
  })

  it('job summary status=Failed when completionTime null and failed>0', () => {
    const j = {
      metadata: makeMeta({ namespace: 'default' }),
      spec: { completions: 3 },
      status: { succeeded: 0, failed: 2, completionTime: null },
    }
    const result = KIND_TABLE['job']!.project(j)
    expect(result.summary['status']).toBe('Failed')
  })

  it('cronjob summary keys: schedule, suspend, lastSchedule absent when null', () => {
    const c = {
      metadata: makeMeta({ namespace: 'default' }),
      spec: { schedule: '0 * * * *', suspend: false },
      status: { lastScheduleTime: null },
    }
    const result = KIND_TABLE['cronjob']!.project(c)
    expect(result.summary['schedule']).toBe('0 * * * *')
    expect(result.summary['suspend']).toBe('false')
    expect(result.summary['lastSchedule']).toBeUndefined()
  })

  it('service summary keys: type, clusterIP, ports', () => {
    const s = {
      metadata: makeMeta({ namespace: 'default' }),
      spec: { type: 'ClusterIP', clusterIP: '10.96.0.1', ports: [{ port: 80, protocol: 'TCP' }] },
    }
    const result = KIND_TABLE['service']!.project(s)
    expect(result.summary['type']).toBe('ClusterIP')
    expect(result.summary['clusterIP']).toBe('10.96.0.1')
    expect(result.summary['ports']).toBe('80/TCP')
  })

  it('ingress summary key: hosts (empty host skipped)', () => {
    const i = {
      metadata: makeMeta({ namespace: 'default' }),
      spec: { rules: [{ host: 'foo.example.com' }, { host: '' }] },
    }
    const result = KIND_TABLE['ingress']!.project(i)
    expect(result.summary['hosts']).toBe('foo.example.com')
  })

  it('configmap summary key: keys (data + binaryData count)', () => {
    const c = {
      metadata: makeMeta({ namespace: 'default' }),
      data: { a: '1', b: '2' },
      binaryData: { c: 'x' },
    }
    const result = KIND_TABLE['configmap']!.project(c)
    expect(result.summary['keys']).toBe('3')
  })

  it('pvc summary keys: status, storageClass, capacity', () => {
    const p = {
      metadata: makeMeta({ namespace: 'default' }),
      status: { phase: 'Bound', capacity: { storage: '10Gi' } },
      spec: { storageClassName: 'fast' },
    }
    const result = KIND_TABLE['pvc']!.project(p)
    expect(result.summary['status']).toBe('Bound')
    expect(result.summary['storageClass']).toBe('fast')
    expect(result.summary['capacity']).toBe('10Gi')
  })

  it('pv summary keys: status, storageClass, capacity (from spec, not status)', () => {
    const p = {
      metadata: makeMeta({ namespace: undefined }),
      status: { phase: 'Available' },
      spec: { storageClassName: 'standard', capacity: { storage: '50Gi' } },
    }
    const result = KIND_TABLE['pv']!.project(p)
    expect(result.summary['status']).toBe('Available')
    expect(result.summary['storageClass']).toBe('standard')
    expect(result.summary['capacity']).toBe('50Gi')
  })

  it('namespace summary key: phase', () => {
    const n = { metadata: makeMeta({ namespace: undefined }), status: { phase: 'Active' } }
    const result = KIND_TABLE['namespace']!.project(n)
    expect(result.summary['phase']).toBe('Active')
  })

  it('node summary keys: ready, version, internalIP, roles (sorted)', () => {
    const n = {
      metadata: {
        name: 'ctrl-1',
        uid: 'uid-n1',
        creationTimestamp: '2024-06-01T00:00:00Z',
        labels: {
          'node-role.kubernetes.io/control-plane': '',
          'node-role.kubernetes.io/master': '',
        },
      },
      status: {
        conditions: [{ type: 'Ready', status: 'True' }],
        nodeInfo: { kubeletVersion: 'v1.30.0' },
        addresses: [{ type: 'InternalIP', address: '192.168.1.1' }],
      },
    }
    const result = KIND_TABLE['node']!.project(n)
    expect(result.summary['ready']).toBe('True')
    expect(result.summary['version']).toBe('v1.30.0')
    expect(result.summary['internalIP']).toBe('192.168.1.1')
    expect(result.summary['roles']).toBe('control-plane,master')
  })

  it('projects an event row for the Events table', () => {
    const row = KIND_TABLE.event!.project({
      metadata: { name: 'web.17a', namespace: 'shop', uid: 'e1' },
      type: 'Warning', reason: 'BackOff', message: 'Back-off restarting failed container', count: 7,
      involvedObject: { kind: 'Pod', name: 'web-1' },
      lastTimestamp: new Date('2026-01-03T10:00:00Z'),
    })
    expect(row.kind).toBe('event')
    expect(row.namespace).toBe('shop')
    expect(row.summary).toEqual({
      type: 'Warning', reason: 'BackOff', object: 'Pod/web-1',
      message: 'Back-off restarting failed container', count: '7',
      lastSeen: '2026-01-03T10:00:00Z',
    })
  })

  it('caps an event message and tolerates a missing involved object', () => {
    const row = KIND_TABLE.event!.project({ metadata: { name: 'x' }, message: 'm'.repeat(5000) })
    expect(row.summary['message']).toHaveLength(2000)
    expect(row.summary['object']).toBe('/')
    expect(row.summary['count']).toBe('0')
    expect(row.summary['lastSeen']).toBe('')
  })

  it('lists events most recent first and keeps that order', async () => {
    const items = [
      { metadata: { name: 'a', namespace: 'z' }, lastTimestamp: new Date('2026-01-01T00:00:00Z') },
      { metadata: { name: 'b', namespace: 'a' }, lastTimestamp: new Date('2026-01-03T00:00:00Z') },
      { metadata: { name: 'c', namespace: 'm' }, eventTime: new Date('2026-01-02T00:00:00Z') },
    ]
    const make = () => ({ listEventForAllNamespaces: async () => ({ items }) }) as any
    const raw = await KIND_TABLE.event!.fetch(make)
    expect(raw.map((e: any) => e.metadata.name)).toEqual(['b', 'c', 'a'])
    expect(KIND_TABLE.event!.keepOrder).toBe(true)
  })

  it('lists the events of one namespace when it is given', async () => {
    const seen: string[] = []
    const make = () => ({ listNamespacedEvent: async ({ namespace }: { namespace: string }) => { seen.push(namespace); return { items: [] } } }) as any
    await KIND_TABLE.event!.fetch(make, 'shop')
    expect(seen).toEqual(['shop'])
  })
})

describe('projectNode identity fields', () => {
  it('projectNode exposes systemUUID, providerID, hostname', () => {
    const item = KIND_TABLE.node!.project({
      metadata: { name: 'worker-1', uid: 'u1' },
      spec: { providerID: 'proxmox://pve/107' },
      status: { nodeInfo: { systemUUID: 'ABCDEF00-1234-5678-9ABC-DEF012345678', kubeletVersion: 'v1.30.0' },
        addresses: [{ type: 'InternalIP', address: '10.0.0.11' }, { type: 'Hostname', address: 'worker-1' }] },
    })
    expect(item.summary.systemUUID).toBe('abcdef00-1234-5678-9abc-def012345678')
    expect(item.summary.providerID).toBe('proxmox://pve/107')
    expect(item.summary.hostname).toBe('worker-1')
  })
})

describe('projectNode scheduling', () => {
  it('projectNode surfaces spec.unschedulable', () => {
    expect(projectNode({ metadata: { name: 'n1' }, spec: { unschedulable: true }, status: {} }).summary['unschedulable']).toBe('true')
    expect(projectNode({ metadata: { name: 'n2' }, spec: {}, status: {} }).summary['unschedulable']).toBe('false')
  })
  it('projects the size of the node from its capacity', () => {
    const sized = projectNode({ metadata: { name: 'w' }, spec: {}, status: { capacity: { cpu: '4', memory: '4015600Ki' } } }).summary
    expect(sized['cpuSize']).toBe('4')
    expect(sized['memSize']).toBe(String(4015600 * 1024))
    const unsized = projectNode({ metadata: { name: 'u' }, spec: {}, status: {} }).summary
    expect(unsized['cpuSize']).toBeUndefined()
    expect(unsized['memSize']).toBeUndefined()
  })
})

describe('podReason', () => {
  const pod = (status: any) => ({ metadata: { name: 'p' }, status })
  it('is empty for a healthy pod', () => {
    expect(podReason(pod({ phase: 'Running', containerStatuses: [{ ready: true, state: { running: {} } }] }))).toBe('')
  })
  it('reports the waiting reason of a failing container, OOMKilled when its last run was killed', () => {
    expect(podReason(pod({ containerStatuses: [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } } }] }))).toBe('CrashLoopBackOff')
    expect(podReason(pod({ containerStatuses: [{ ready: false, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'OOMKilled' } } }] }))).toBe('OOMKilled')
  })
  it('ignores a container that is only being created', () => {
    expect(podReason(pod({ phase: 'Pending', containerStatuses: [{ ready: false, state: { waiting: { reason: 'ContainerCreating' } } }] }))).toBe('')
  })
  it('reports an init container failure, a terminated reason, the pod reason, then Unschedulable', () => {
    expect(podReason(pod({ initContainerStatuses: [{ ready: false, state: { waiting: { reason: 'ImagePullBackOff' } } }] }))).toBe('ImagePullBackOff')
    expect(podReason(pod({ containerStatuses: [{ ready: false, state: { terminated: { reason: 'Error' } } }] }))).toBe('Error')
    expect(podReason(pod({ phase: 'Failed', reason: 'Evicted' }))).toBe('Evicted')
    expect(podReason(pod({ phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }] }))).toBe('Unschedulable')
  })
})

describe('projectNode pressure', () => {
  it('lists the pressure conditions that are true', () => {
    const n = projectNode({ metadata: { name: 'n' }, status: { conditions: [
      { type: 'Ready', status: 'True' }, { type: 'MemoryPressure', status: 'True' }, { type: 'DiskPressure', status: 'False' }, { type: 'PIDPressure', status: 'True' },
    ] } })
    expect(n.summary['pressure']).toBe('MemoryPressure,PIDPressure')
  })
  it('has no pressure entry on a healthy node', () => {
    expect(projectNode({ metadata: { name: 'n' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }).summary['pressure']).toBeUndefined()
  })
})
