/**
 * TDD tests for detail.ts - ports resourcedetail_test.go.
 * All fixtures are raw deserialized K8s object shapes (no .body wrapper).
 */
import { describe, it, expect } from 'vitest'
import {
  emptyIfNil,
  filterAnnotations,
  isSensitiveAnnotationKey,
  kvSection,
  tableSection,
  selectorTable,
  DETAIL_TABLE_CAP,
  buildDetailBase,
  detailNode,
  detailNamespace,
  detailPod,
  detailDeployment,
  detailStatefulSet,
  detailDaemonSet,
  detailJob,
  detailCronJob,
  detailService,
  detailIngress,
  detailConfigMap,
  detailPVC,
  detailPV,
} from './detail'

// ── helpers ────────────────────────────────────────────────────────────────

function makeMeta(overrides: Record<string, any> = {}) {
  return {
    name: 'test-obj',
    namespace: 'default',
    uid: 'uid-1',
    creationTimestamp: '2024-06-01T00:00:00Z',
    ...overrides,
  }
}

// ── emptyIfNil ─────────────────────────────────────────────────────────────

describe('emptyIfNil', () => {
  it('returns {} for null', () => {
    expect(emptyIfNil(null)).toEqual({})
  })
  it('returns {} for undefined', () => {
    expect(emptyIfNil(undefined)).toEqual({})
  })
  it('returns the map when defined', () => {
    const m = { a: '1' }
    expect(emptyIfNil(m)).toBe(m)
  })
})

// ── filterAnnotations ──────────────────────────────────────────────────────

describe('filterAnnotations', () => {
  it('returns {} for null', () => {
    expect(filterAnnotations(null)).toEqual({})
  })
  it('returns {} for undefined', () => {
    expect(filterAnnotations(undefined)).toEqual({})
  })
  it('drops sensitive keys', () => {
    const m = {
      'kubectl.kubernetes.io/last-applied-configuration': 'big json',
      'some-token': 'abc',
      'my-secret': 'xyz',
      'my-password': 'pass',
      'tls.key': 'privkey',
      'safe-annotation': 'ok',
    }
    const out = filterAnnotations(m)
    expect(out).toEqual({ 'safe-annotation': 'ok' })
  })
  it('truncates long values', () => {
    const long = 'x'.repeat(2100)
    const out = filterAnnotations({ safe: long })
    expect(out['safe'].endsWith('...[truncated]')).toBe(true)
    expect(out['safe'].length).toBe(2000 + '...[truncated]'.length)
  })
  it('keeps values at exactly 2000 chars', () => {
    const exactly = 'y'.repeat(2000)
    const out = filterAnnotations({ safe: exactly })
    expect(out['safe']).toBe(exactly)
  })
  it('always returns non-null even for empty input', () => {
    expect(filterAnnotations({})).toEqual({})
  })
})

describe('isSensitiveAnnotationKey', () => {
  it('flags kubectl last-applied-configuration', () => {
    expect(isSensitiveAnnotationKey('kubectl.kubernetes.io/last-applied-configuration')).toBe(true)
  })
  it('flags key containing "secret"', () => {
    expect(isSensitiveAnnotationKey('my-secret-annotation')).toBe(true)
  })
  it('does not flag safe annotation', () => {
    expect(isSensitiveAnnotationKey('deployment.kubernetes.io/revision')).toBe(false)
  })
  // Pins parity with Go sensitiveAnnotationSubstrings:
  // {"token","secret","password","passwd","credential","key","private-key","tls.key"}
  it('flags token', () => { expect(isSensitiveAnnotationKey('some-token-annotation')).toBe(true) })
  it('flags password', () => { expect(isSensitiveAnnotationKey('db.password')).toBe(true) })
  it('flags passwd', () => { expect(isSensitiveAnnotationKey('db-passwd')).toBe(true) })
  it('flags credential', () => { expect(isSensitiveAnnotationKey('cloud-credential')).toBe(true) })
  it('flags bare key substring (Go has it too)', () => {
    expect(isSensitiveAnnotationKey('helm.sh/release-key-id')).toBe(true)
  })
  it('flags private-key', () => { expect(isSensitiveAnnotationKey('ssh-private-key')).toBe(true) })
  it('flags tls.key', () => { expect(isSensitiveAnnotationKey('tls.key')).toBe(true) })
  it('keeps helm chart annotation safe', () => {
    expect(isSensitiveAnnotationKey('helm.sh/chart')).toBe(false)
  })
  it('keeps meta.helm.sh/release-name safe', () => {
    expect(isSensitiveAnnotationKey('meta.helm.sh/release-name')).toBe(false)
  })
  it('keeps deployment revision safe', () => {
    expect(isSensitiveAnnotationKey('deployment.kubernetes.io/revision')).toBe(false)
  })
})

// ── kvSection ──────────────────────────────────────────────────────────────

describe('kvSection', () => {
  it('builds a section with title and rows', () => {
    const sec = kvSection('info', { label: 'Phase', value: 'Active' })
    expect(sec.title).toBe('info')
    expect(sec.rows).toEqual([{ label: 'Phase', value: 'Active' }])
    expect(sec.table).toBeUndefined()
  })
})

// ── tableSection ───────────────────────────────────────────────────────────

describe('tableSection', () => {
  it('returns null for empty rows', () => {
    expect(tableSection('selector', ['key', 'op', 'val'], [])).toBeNull()
  })
  it('returns a section for non-empty rows', () => {
    const sec = tableSection('selector', ['key', 'op', 'val'], [['app', '=', 'nginx']])
    expect(sec).not.toBeNull()
    expect(sec!.table!.columns).toEqual(['key', 'op', 'val'])
    expect(sec!.table!.rows).toEqual([['app', '=', 'nginx']])
    expect(sec!.table!.truncated).toBe(false)
  })
  it(`caps at ${DETAIL_TABLE_CAP} rows and sets truncated`, () => {
    const rows = Array.from({ length: DETAIL_TABLE_CAP + 5 }, (_, i) => [`k${i}`, '=', `v${i}`])
    const sec = tableSection('selector', ['key', 'op', 'val'], rows)
    expect(sec!.table!.rows.length).toBe(DETAIL_TABLE_CAP)
    expect(sec!.table!.truncated).toBe(true)
  })
  it('does not set truncated when at exactly cap', () => {
    const rows = Array.from({ length: DETAIL_TABLE_CAP }, (_, i) => [`k${i}`, '=', `v${i}`])
    const sec = tableSection('selector', ['key', 'op', 'val'], rows)
    expect(sec!.table!.truncated).toBe(false)
  })
})

// ── selectorTable ──────────────────────────────────────────────────────────

describe('selectorTable', () => {
  it('returns null for null selector', () => {
    expect(selectorTable(null)).toBeNull()
  })
  it('renders matchLabels sorted by key', () => {
    const sel = {
      matchLabels: { 'z-app': 'nginx', 'a-app': 'frontend' },
    }
    const sec = selectorTable(sel)
    expect(sec).not.toBeNull()
    const rows = sec!.table!.rows
    expect(rows[0]).toEqual(['a-app', '=', 'frontend'])
    expect(rows[1]).toEqual(['z-app', '=', 'nginx'])
  })
  it('renders matchExpressions', () => {
    const sel = {
      matchLabels: {},
      matchExpressions: [
        { key: 'env', operator: 'In', values: ['prod', 'staging'] },
        { key: 'tier', operator: 'NotIn', values: ['db'] },
      ],
    }
    const sec = selectorTable(sel)
    const rows = sec!.table!.rows
    expect(rows[0]).toEqual(['env', 'In', 'prod,staging'])
    expect(rows[1]).toEqual(['tier', 'NotIn', 'db'])
  })
  it('renders matchLabels before matchExpressions', () => {
    const sel = {
      matchLabels: { app: 'web' },
      matchExpressions: [{ key: 'env', operator: 'Exists', values: [] }],
    }
    const sec = selectorTable(sel)
    const rows = sec!.table!.rows
    expect(rows[0]).toEqual(['app', '=', 'web'])
    expect(rows[1]).toEqual(['env', 'Exists', ''])
  })
})

// ── detailNode ─────────────────────────────────────────────────────────────

describe('detailNode', () => {
  function makeNode(overrides: any = {}) {
    return {
      metadata: makeMeta({ name: 'node-1' }),
      spec: { taints: [], ...overrides.spec },
      status: {
        nodeInfo: {
          kubeletVersion: 'v1.28.0',
          osImage: 'Ubuntu 22.04',
          kernelVersion: '5.15.0',
          containerRuntimeVersion: 'containerd://1.7.0',
          architecture: 'amd64',
        },
        addresses: [{ type: 'InternalIP', address: '10.0.0.1' }],
        capacity: {
          cpu: '4',
          memory: '8Gi',
          pods: '110',
          'ephemeral-storage': '100Gi',
        },
        allocatable: {
          cpu: '3800m',
          memory: '7Gi',
          pods: '110',
          'ephemeral-storage': '95Gi',
        },
        conditions: [
          { type: 'Ready', status: 'True', reason: '' },
          { type: 'MemoryPressure', status: 'False', reason: 'KubeletHasSufficientMemory' },
        ],
        ...overrides.status,
      },
    }
  }

  it('includes info section with kubelet version and internal IP', () => {
    const n = makeNode()
    const secs = detailNode(n)
    const info = secs.find(s => s.title === 'info')
    expect(info).toBeDefined()
    const labels = info!.rows!.map(r => r.label)
    expect(labels).toContain('Kubelet Version')
    expect(labels).toContain('Internal IP')
    const ipRow = info!.rows!.find(r => r.label === 'Internal IP')
    expect(ipRow!.value).toBe('10.0.0.1')
  })

  it('includes capacity table with fixed resource order', () => {
    const n = makeNode()
    const secs = detailNode(n)
    const cap = secs.find(s => s.title === 'capacity')
    expect(cap).toBeDefined()
    expect(cap!.table!.columns).toEqual(['resource', 'capacity', 'allocatable'])
    const resourceNames = cap!.table!.rows.map(r => r[0])
    expect(resourceNames).toEqual(['cpu', 'memory', 'pods', 'ephemeral-storage'])
  })

  it('includes conditions table', () => {
    const n = makeNode()
    const secs = detailNode(n)
    const cond = secs.find(s => s.title === 'conditions')
    expect(cond).toBeDefined()
    expect(cond!.table!.rows[0]).toEqual(['Ready', 'True', ''])
    expect(cond!.table!.rows[1][2]).toBe('KubeletHasSufficientMemory')
  })

  it('includes taints table when taints present', () => {
    const n = makeNode({
      spec: {
        taints: [{ key: 'node-role.kubernetes.io/control-plane', value: '', effect: 'NoSchedule' }],
      },
    })
    const secs = detailNode(n)
    const taints = secs.find(s => s.title === 'taints')
    expect(taints).toBeDefined()
    expect(taints!.table!.rows[0]).toEqual(['node-role.kubernetes.io/control-plane', '', 'NoSchedule'])
  })

  it('omits taints section when no taints', () => {
    const n = makeNode({ spec: { taints: [] } })
    const secs = detailNode(n)
    expect(secs.find(s => s.title === 'taints')).toBeUndefined()
  })

  it('info section reports Scheduling SchedulingDisabled when cordoned', () => {
    const secs = detailNode(makeNode({ spec: { unschedulable: true } }))
    const info = secs.find(s => s.title === 'info')
    const sched = info!.rows!.find(r => r.label === 'Scheduling')
    expect(sched).toBeDefined()
    expect(sched!.value).toBe('SchedulingDisabled')
  })

  it('info section reports Scheduling Schedulable when not cordoned', () => {
    const secs = detailNode(makeNode())
    const info = secs.find(s => s.title === 'info')
    const sched = info!.rows!.find(r => r.label === 'Scheduling')
    expect(sched).toBeDefined()
    expect(sched!.value).toBe('Schedulable')
  })
})

// ── detailNamespace ────────────────────────────────────────────────────────

describe('detailNamespace', () => {
  it('returns info section with Phase', () => {
    const ns = { metadata: makeMeta({ name: 'default' }), status: { phase: 'Active' } }
    const secs = detailNamespace(ns)
    expect(secs.length).toBe(1)
    expect(secs[0].title).toBe('info')
    expect(secs[0].rows![0]).toEqual({ label: 'Phase', value: 'Active' })
  })
})

// ── detailPod ──────────────────────────────────────────────────────────────

describe('detailPod', () => {
  function makePod(overrides: any = {}) {
    return {
      metadata: makeMeta({ name: 'test-pod' }),
      spec: {
        nodeName: 'node-1',
        serviceAccountName: 'default',
        priorityClassName: '',
        containers: [
          {
            name: 'nginx',
            image: 'nginx:latest',
            resources: {
              requests: { cpu: '100m', memory: '128Mi' },
              limits: { cpu: '500m', memory: '256Mi' },
            },
          },
        ],
        initContainers: [],
        ephemeralContainers: [],
        volumes: [
          { name: 'config', configMap: { name: 'my-config' } },
          { name: 'data', emptyDir: {} },
          { name: 'secret-vol', secret: { secretName: 'my-secret' } },
        ],
        ...overrides.spec,
      },
      status: {
        phase: 'Running',
        podIP: '10.0.0.2',
        hostIP: '192.168.1.1',
        qosClass: 'Burstable',
        containerStatuses: [],
        conditions: [],
        ...overrides.status,
      },
    }
  }

  it('includes info section', () => {
    const p = makePod()
    const secs = detailPod(p)
    const info = secs.find(s => s.title === 'info')
    expect(info).toBeDefined()
    expect(info!.rows!.find(r => r.label === 'QoS Class')!.value).toBe('Burstable')
    expect(info!.rows!.find(r => r.label === 'Node')!.value).toBe('node-1')
  })

  it('includes resources table with container rows', () => {
    const p = makePod()
    const secs = detailPod(p)
    const res = secs.find(s => s.title === 'resources')
    expect(res).toBeDefined()
    expect(res!.table!.columns).toEqual(['type', 'container', 'cpuReq', 'cpuLim', 'memReq', 'memLim'])
    const appRow = res!.table!.rows.find(r => r[1] === 'nginx')!
    expect(appRow[0]).toBe('app')    // column 0 = type label ('app' for regular containers)
    expect(appRow[1]).toBe('nginx')  // column 1 = container name (distinct from type label)
    expect(appRow[2]).toBe('100m')
    expect(appRow[3]).toBe('500m')
  })

  it('includes volumes table with type only (no source detail)', () => {
    const p = makePod()
    const secs = detailPod(p)
    const vols = secs.find(s => s.title === 'volumes')
    expect(vols).toBeDefined()
    const rows = vols!.table!.rows
    const configRow = rows.find(r => r[0] === 'config')!
    expect(configRow[1]).toBe('ConfigMap')
    const secretRow = rows.find(r => r[0] === 'secret-vol')!
    expect(secretRow[1]).toBe('Secret')
    // Verify no secret name is in the volume rows
    for (const row of rows) {
      expect(row.join(' ')).not.toContain('my-secret')
      expect(row.join(' ')).not.toContain('my-config')
    }
  })

  it('includes init container type in resources', () => {
    const p = makePod({
      spec: {
        initContainers: [
          {
            name: 'init-1',
            image: 'busybox',
            resources: {
              requests: { cpu: '50m', memory: '64Mi' },
              limits: {},
            },
          },
        ],
      },
    })
    const secs = detailPod(p)
    const res = secs.find(s => s.title === 'resources')!
    const initRow = res.table!.rows.find(r => r[1] === 'init-1')!
    expect(initRow[0]).toBe('init')
  })
})

// ── detailConfigMap ────────────────────────────────────────────────────────

describe('detailConfigMap', () => {
  it('returns dataKeys section with sorted keys only (no values)', () => {
    const cm = {
      metadata: makeMeta({ name: 'my-cm' }),
      data: { 'z-key': 'some value', 'a-key': 'another value' },
      binaryData: { 'b.bin': 'base64data' },
    }
    const secs = detailConfigMap(cm)
    expect(secs.length).toBe(1)
    expect(secs[0].title).toBe('dataKeys')
    expect(secs[0].table!.columns).toEqual(['key'])
    const keys = secs[0].table!.rows.map(r => r[0])
    expect(keys).toEqual(['a-key', 'b.bin', 'z-key'])
    // Ensure no values are in rows
    for (const row of secs[0].table!.rows) {
      expect(row.join('')).not.toContain('some value')
      expect(row.join('')).not.toContain('another value')
      expect(row.join('')).not.toContain('base64data')
    }
  })

  it('returns empty array when no data or binaryData', () => {
    const cm = { metadata: makeMeta({ name: 'empty-cm' }), data: {}, binaryData: {} }
    expect(detailConfigMap(cm)).toEqual([])
  })
})

// ── detailPVC ──────────────────────────────────────────────────────────────

describe('detailPVC', () => {
  it('returns info section with phase and storage class', () => {
    const pvc = {
      metadata: makeMeta({ name: 'my-pvc' }),
      spec: {
        storageClassName: 'standard',
        volumeMode: 'Filesystem',
        volumeName: 'pvc-123',
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: '10Gi' } },
      },
      status: { phase: 'Bound' },
    }
    const secs = detailPVC(pvc)
    expect(secs[0].title).toBe('info')
    const rows = secs[0].rows!
    expect(rows.find(r => r.label === 'Phase')!.value).toBe('Bound')
    expect(rows.find(r => r.label === 'Storage Class')!.value).toBe('standard')
    expect(rows.find(r => r.label === 'Requested')!.value).toBe('10Gi')
    expect(rows.find(r => r.label === 'Access Modes')!.value).toBe('ReadWriteOnce')
  })
})

// ── detailPV ───────────────────────────────────────────────────────────────

describe('detailPV', () => {
  it('returns source type only (no connection details)', () => {
    const pv = {
      metadata: makeMeta({ name: 'pv-1', namespace: undefined }),
      spec: {
        capacity: { storage: '50Gi' },
        storageClassName: 'standard',
        persistentVolumeReclaimPolicy: 'Delete',
        accessModes: ['ReadWriteOnce'],
        volumeMode: 'Filesystem',
        claimRef: { namespace: 'default', name: 'my-pvc' },
        nfs: { server: '10.0.0.5', path: '/data' },
      },
      status: { phase: 'Bound' },
    }
    const secs = detailPV(pv)
    expect(secs[0].title).toBe('info')
    const rows = secs[0].rows!
    expect(rows.find(r => r.label === 'Source Type')!.value).toBe('NFS')
    expect(rows.find(r => r.label === 'Claim')!.value).toBe('default/my-pvc')
    expect(rows.find(r => r.label === 'Capacity')!.value).toBe('50Gi')
    // Ensure NFS server/path not in any row value
    for (const row of rows) {
      expect(row.value).not.toContain('10.0.0.5')
      expect(row.value).not.toContain('/data')
    }
  })
})

// ── detailDeployment ───────────────────────────────────────────────────────

describe('detailDeployment', () => {
  it('includes info and selector sections', () => {
    const d = {
      metadata: makeMeta({ name: 'nginx' }),
      spec: {
        replicas: 3,
        minReadySeconds: 10,
        revisionHistoryLimit: 10,
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' },
        },
        selector: { matchLabels: { app: 'nginx' } },
      },
      status: {
        updatedReplicas: 3,
        availableReplicas: 3,
        readyReplicas: 3,
        conditions: [],
      },
    }
    const secs = detailDeployment(d)
    const info = secs.find(s => s.title === 'info')!
    expect(info.rows!.find(r => r.label === 'Strategy')!.value).toBe('RollingUpdate')
    expect(info.rows!.find(r => r.label === 'Max Surge')!.value).toBe('25%')
    const sel = secs.find(s => s.title === 'selector')!
    expect(sel.table!.rows).toEqual([['app', '=', 'nginx']])
  })
})

// ── detailService ──────────────────────────────────────────────────────────

describe('detailService', () => {
  it('includes ports section', () => {
    const svc = {
      metadata: makeMeta({ name: 'my-svc' }),
      spec: {
        type: 'ClusterIP',
        clusterIP: '10.96.0.1',
        sessionAffinity: 'None',
        externalTrafficPolicy: '',
        externalIPs: [],
        selector: { app: 'web' },
        ports: [{ name: 'http', port: 80, targetPort: 8080, protocol: 'TCP', nodePort: 0 }],
      },
      status: { loadBalancer: {} },
    }
    const secs = detailService(svc)
    const ports = secs.find(s => s.title === 'ports')!
    expect(ports.table!.rows[0]).toEqual(['http', '80', '8080', 'TCP', '0'])
  })

  it('includes selector section with sorted keys', () => {
    const svc = {
      metadata: makeMeta({ name: 'my-svc' }),
      spec: {
        type: 'ClusterIP',
        clusterIP: '10.96.0.1',
        sessionAffinity: 'None',
        externalTrafficPolicy: '',
        externalIPs: [],
        selector: { 'z-label': 'z', 'a-label': 'a' },
        ports: [],
      },
      status: { loadBalancer: {} },
    }
    const secs = detailService(svc)
    const sel = secs.find(s => s.title === 'selector')!
    expect(sel.table!.rows[0][0]).toBe('a-label')
    expect(sel.table!.rows[1][0]).toBe('z-label')
  })
})

// ── buildDetailBase ────────────────────────────────────────────────────────

describe('buildDetailBase', () => {
  it('labels are always non-null even when metadata has no labels', () => {
    const obj = { metadata: makeMeta({ labels: undefined }) }
    const detail = buildDetailBase('namespace', obj)
    expect(detail.labels).toEqual({})
    expect(typeof detail.labels).toBe('object')
    expect(() => Object.keys(detail.labels)).not.toThrow()
  })

  it('annotations are always non-null even when metadata has no annotations', () => {
    const obj = { metadata: makeMeta({ annotations: undefined }) }
    const detail = buildDetailBase('namespace', obj)
    expect(detail.annotations).toEqual({})
    expect(typeof detail.annotations).toBe('object')
    expect(() => Object.keys(detail.annotations)).not.toThrow()
  })

  it('labels is non-null when labels present', () => {
    const obj = { metadata: makeMeta({ labels: { app: 'web' } }) }
    const detail = buildDetailBase('namespace', obj)
    expect(detail.labels).toEqual({ app: 'web' })
  })

  it('filters sensitive annotations from output', () => {
    const obj = {
      metadata: makeMeta({
        annotations: {
          'my-secret-key': 'should-be-hidden',
          'safe-annotation': 'visible',
        },
      }),
    }
    const detail = buildDetailBase('namespace', obj)
    expect(detail.annotations['my-secret-key']).toBeUndefined()
    expect(detail.annotations['safe-annotation']).toBe('visible')
  })

  it('populates ref with kind, namespace, name, uid', () => {
    const obj = { metadata: makeMeta({ name: 'my-ns', namespace: undefined, uid: 'uid-42' }) }
    const detail = buildDetailBase('namespace', obj)
    expect(detail.ref.kind).toBe('namespace')
    expect(detail.ref.name).toBe('my-ns')
    expect(detail.ref.uid).toBe('uid-42')
  })

  it('populates containers for pod kind', () => {
    const p = {
      metadata: makeMeta({ name: 'test-pod' }),
      spec: {
        containers: [{ name: 'app', image: 'nginx:latest', resources: {} }],
        initContainers: [],
        ephemeralContainers: [],
      },
      status: {
        phase: 'Running',
        containerStatuses: [{ name: 'app', ready: true, restartCount: 2, state: { running: { startedAt: '2024-01-01T00:00:00Z' } } }],
        initContainerStatuses: [],
      },
    }
    const detail = buildDetailBase('pod', p)
    expect(detail.containers).toBeDefined()
    expect(detail.containers!.length).toBe(1)
    expect(detail.containers![0].name).toBe('app')
    expect(detail.containers![0].ready).toBe(true)
    expect(detail.containers![0].restartCount).toBe(2)
    expect(detail.containers![0].state).toBe('running')
    expect(detail.summary['phase']).toBe('Running')
  })

  it('populates owners when ownerReferences present', () => {
    const obj = {
      metadata: makeMeta({
        ownerReferences: [{ kind: 'ReplicaSet', name: 'nginx-rs-abc', uid: 'rs-uid' }],
      }),
    }
    const detail = buildDetailBase('pod', obj)
    expect(detail.owners).toBeDefined()
    expect(detail.owners![0]).toEqual({ kind: 'ReplicaSet', name: 'nginx-rs-abc' })
  })

  it('yaml is empty string (to be filled by Task 6)', () => {
    const obj = { metadata: makeMeta() }
    const detail = buildDetailBase('namespace', obj)
    expect(detail.yaml).toBe('')
  })

  it('sections are populated for known kinds', () => {
    const ns = {
      metadata: makeMeta({ name: 'default' }),
      status: { phase: 'Active' },
    }
    const detail = buildDetailBase('namespace', ns)
    expect(detail.sections).toBeDefined()
    expect(detail.sections!.length).toBeGreaterThan(0)
  })

  it('sections are undefined for unknown kinds', () => {
    const obj = { metadata: makeMeta() }
    const detail = buildDetailBase('unknown-kind', obj)
    expect(detail.sections).toBeUndefined()
  })
})

// ── detailIngress ──────────────────────────────────────────────────────────

describe('detailIngress', () => {
  it('masks TLS secret as [hidden]', () => {
    const ing = {
      metadata: makeMeta({ name: 'my-ingress' }),
      spec: {
        ingressClassName: 'nginx',
        tls: [{ hosts: ['example.com'], secretName: 'my-tls-secret' }],
        rules: [
          {
            host: 'example.com',
            http: {
              paths: [
                { path: '/', pathType: 'Prefix', backend: { service: { name: 'my-svc', port: { number: 80 } } } },
              ],
            },
          },
        ],
      },
      status: { loadBalancer: {} },
    }
    const secs = detailIngress(ing)
    const tls = secs.find(s => s.title === 'tls')!
    expect(tls.table!.rows[0][1]).toBe('[hidden]')
    expect(tls.table!.rows[0][1]).not.toContain('my-tls-secret')
    const rules = secs.find(s => s.title === 'rules')!
    expect(rules.table!.rows[0]).toEqual(['example.com', '/', 'Prefix', 'my-svc:80'])
  })
})

// ── detailJob / detailCronJob / detailStatefulSet / detailDaemonSet ─────────

describe('detailJob', () => {
  it('returns info section with job status fields', () => {
    const j = {
      metadata: makeMeta({ name: 'batch-job' }),
      spec: { completions: 3, parallelism: 1, backoffLimit: 6 },
      status: { active: 0, succeeded: 2, failed: 0, startTime: '2024-06-01T00:00:00Z', completionTime: null, conditions: [] },
    }
    const secs = detailJob(j)
    const info = secs[0]
    expect(info.rows!.find(r => r.label === 'Completions')!.value).toBe('3')
    expect(info.rows!.find(r => r.label === 'Succeeded')!.value).toBe('2')
  })
})

describe('detailCronJob', () => {
  it('returns schedule and suspend info', () => {
    const cj = {
      metadata: makeMeta({ name: 'my-cron' }),
      spec: {
        schedule: '*/5 * * * *',
        suspend: false,
        concurrencyPolicy: 'Allow',
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 1,
      },
      status: { active: [], lastScheduleTime: null, lastSuccessfulTime: null },
    }
    const secs = detailCronJob(cj)
    expect(secs[0].rows!.find(r => r.label === 'Schedule')!.value).toBe('*/5 * * * *')
    expect(secs[0].rows!.find(r => r.label === 'Suspend')!.value).toBe('false')
  })
})

describe('detailStatefulSet', () => {
  it('includes info and selector sections', () => {
    const sts = {
      metadata: makeMeta({ name: 'db' }),
      spec: {
        replicas: 3,
        serviceName: 'db-svc',
        podManagementPolicy: 'OrderedReady',
        updateStrategy: { type: 'RollingUpdate', rollingUpdate: { partition: 1 } },
        revisionHistoryLimit: 10,
        selector: { matchLabels: { app: 'db' } },
      },
      status: { readyReplicas: 2, currentReplicas: 3, updatedReplicas: 3, conditions: [] },
    }
    const secs = detailStatefulSet(sts)
    const info = secs.find(s => s.title === 'info')!
    expect(info.rows!.find(r => r.label === 'Partition')!.value).toBe('1')
    expect(info.rows!.find(r => r.label === 'Service Name')!.value).toBe('db-svc')
    const sel = secs.find(s => s.title === 'selector')!
    expect(sel.table!.rows).toEqual([['app', '=', 'db']])
  })
})

describe('detailDaemonSet', () => {
  it('returns info with daemon set status', () => {
    const ds = {
      metadata: makeMeta({ name: 'fluentd' }),
      spec: {
        updateStrategy: { type: 'RollingUpdate' },
        selector: { matchLabels: { app: 'fluentd' } },
      },
      status: {
        desiredNumberScheduled: 5,
        currentNumberScheduled: 5,
        numberReady: 4,
        updatedNumberScheduled: 5,
        numberAvailable: 4,
        numberMisscheduled: 0,
      },
    }
    const secs = detailDaemonSet(ds)
    const info = secs.find(s => s.title === 'info')!
    expect(info.rows!.find(r => r.label === 'Desired')!.value).toBe('5')
    expect(info.rows!.find(r => r.label === 'Ready')!.value).toBe('4')
  })
})
