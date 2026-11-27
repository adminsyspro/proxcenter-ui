/**
 * Absence tests for sanitize.ts -- ports sanitize_test.go.
 * Assert secrets/paths/managed-fields are NOT present; non-sensitive fields ARE present.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeToYaml, filterAnnotations } from './sanitize'

// ── filterAnnotations ───────────────────────────────────────────────────────

describe('filterAnnotations', () => {
  it('drops sensitive keys', () => {
    const got = filterAnnotations({ 'api-token': 'x', 'team': 'infra' })
    expect(got['api-token']).toBeUndefined()
    expect(got['team']).toBe('infra')
  })

  it('drops last-applied-configuration', () => {
    const got = filterAnnotations({
      'kubectl.kubernetes.io/last-applied-configuration': '{}',
      'safe': 'yes',
    })
    expect(got['kubectl.kubernetes.io/last-applied-configuration']).toBeUndefined()
    expect(got['safe']).toBe('yes')
  })

  it('truncates values longer than 2000 chars', () => {
    const long = 'a'.repeat(2100)
    const got = filterAnnotations({ 'desc': long })
    expect(got['desc'].endsWith('...[truncated]')).toBe(true)
    expect(got['desc'].length).toBeLessThan(2100)
  })

  it('returns empty object for null/undefined', () => {
    expect(filterAnnotations(null)).toEqual({})
    expect(filterAnnotations(undefined)).toEqual({})
  })
})

// ── pod: env values ─────────────────────────────────────────────────────────

describe('sanitizeToYaml - pod env values', () => {
  it('redacts literal env values in containers', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p1', namespace: 'ns' },
      spec: {
        containers: [{
          name: 'c1',
          env: [
            { name: 'PLAIN', value: 'supersecret' },
            { name: 'FROMREF', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
          ],
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('supersecret')
    expect(out).toContain('PLAIN')
    expect(out).toContain('[redacted]')
    expect(out).toContain('FROMREF')
  })

  it('redacts literal env values in initContainers', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p2', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        initContainers: [{
          name: 'init1',
          env: [{ name: 'INIT_SECRET', value: 'initsecretvalue' }],
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('initsecretvalue')
    expect(out).toContain('INIT_SECRET')
    expect(out).toContain('[redacted]')
  })

  it('redacts literal env values in ephemeralContainers', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p3', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        ephemeralContainers: [{
          name: 'debug1',
          env: [{ name: 'DEBUG_TOKEN', value: 'ephemeralsecretvalue' }],
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('ephemeralsecretvalue')
    expect(out).toContain('DEBUG_TOKEN')
  })
})

// ── pod: metadata redaction ─────────────────────────────────────────────────

describe('sanitizeToYaml - metadata', () => {
  it('strips managedFields', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'p1',
        namespace: 'ns',
        managedFields: [{ manager: 'kubelet', operation: 'Update' }],
      },
      spec: { containers: [{ name: 'c1' }] },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('managedFields')
    expect(out).not.toContain('kubelet')
  })

  it('drops sensitive annotations', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'p1',
        namespace: 'ns',
        annotations: {
          'kubectl.kubernetes.io/last-applied-configuration': '{...big...}',
          'app.example.com/db-password': 'hunter2',
          'keep-me': 'ok',
        },
      },
      spec: { containers: [{ name: 'c1' }] },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('last-applied-configuration')
    expect(out).toContain('keep-me')
  })
})

// ── pod: secret volume ──────────────────────────────────────────────────────

describe('sanitizeToYaml - secret volume', () => {
  it('redacts secretName but keeps volume name and type key', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-sec', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-secret-vol',
          secret: { secretName: 'db-credentials' },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('db-credentials')
    expect(out).toContain('my-secret-vol')
    expect(out).toContain('secret')
  })
})

// ── pod: configMap volume ───────────────────────────────────────────────────

describe('sanitizeToYaml - configMap volume', () => {
  it('redacts configMap name but keeps volume name and type key', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-cm', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-cm-vol',
          configMap: { name: 'app-config' },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('app-config')
    expect(out).toContain('my-cm-vol')
    expect(out).toContain('configMap')
  })
})

// ── pod: projected serviceAccountToken ─────────────────────────────────────

describe('sanitizeToYaml - projected serviceAccountToken', () => {
  it('zeroes projected source, keeps volume name and type key', () => {
    const saPath = '/var/run/secrets/kubernetes.io/serviceaccount/token'
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-proj', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'kube-api-access',
          projected: {
            sources: [{
              serviceAccountToken: { path: saPath },
            }],
          },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain(saPath)
    expect(out).toContain('kube-api-access')
    expect(out).toContain('projected')
  })
})

// ── pod: CSI volume ─────────────────────────────────────────────────────────

describe('sanitizeToYaml - CSI volume', () => {
  it('redacts nodePublishSecretRef and volumeAttributes, keeps driver and volume name', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-csi', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-csi-vol',
          csi: {
            driver: 'secrets-store.csi.k8s.io',
            nodePublishSecretRef: { name: 'vault-csi-secret' },
            volumeAttributes: { secretProviderClass: 'my-sensitive-class' },
          },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('vault-csi-secret')
    expect(out).not.toContain('my-sensitive-class')
    expect(out).toContain('my-csi-vol')
    expect(out).toContain('secrets-store.csi.k8s.io')
  })
})

// ── pod: FC volume ──────────────────────────────────────────────────────────

describe('sanitizeToYaml - FC volume', () => {
  it('zeroes FC volume source, keeps volume name', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-fc', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-fc-vol',
          fc: { targetWWNs: ['0x5005076801'] },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('0x5005076801')
    expect(out).toContain('my-fc-vol')
  })
})

// ── pod: GCEPersistentDisk volume ───────────────────────────────────────────

describe('sanitizeToYaml - GCEPersistentDisk volume', () => {
  it('redacts PDName, keeps volume name', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-gce', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-gce-vol',
          gcePersistentDisk: { pdName: 'my-gce-disk' },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('my-gce-disk')
    expect(out).toContain('my-gce-vol')
  })
})

// ── pod: AWSElasticBlockStore volume ────────────────────────────────────────

describe('sanitizeToYaml - AWSElasticBlockStore volume', () => {
  it('redacts volumeID, keeps volume name', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-ebs', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-ebs-vol',
          awsElasticBlockStore: { volumeID: 'vol-0ebs123' },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('vol-0ebs123')
    expect(out).toContain('my-ebs-vol')
  })
})

// ── PV: backend source redaction ────────────────────────────────────────────

describe('sanitizeToYaml - PV NFS source', () => {
  it('redacts server and path, keeps nfs type key', () => {
    const pv = {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: { name: 'pv-nfs' },
      spec: {
        nfs: {
          server: 'nfs.internal.example.com',
          path: '/exports/data',
        },
      },
    }
    const out = sanitizeToYaml(pv)
    expect(out).not.toContain('nfs.internal.example.com')
    expect(out).not.toContain('/exports/data')
    expect(out).toContain('nfs')
  })
})

describe('sanitizeToYaml - PV CSI source', () => {
  it('redacts volumeHandle, preserves driver, keeps csi type key', () => {
    const pv = {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: { name: 'pv-csi' },
      spec: {
        csi: {
          driver: 'disk.csi.azure.com',
          volumeHandle: 'vol-0abc123def456',
        },
      },
    }
    const out = sanitizeToYaml(pv)
    expect(out).not.toContain('vol-0abc123def456')
    expect(out).toContain('csi')
    expect(out).toContain('disk.csi.azure.com')
  })
})

describe('sanitizeToYaml - PV FlexVolume source', () => {
  it('strips secretRef and options, keeps driver and flexVolume key', () => {
    const pv = {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: { name: 'pv-flex' },
      spec: {
        flexVolume: {
          driver: 'example.com/flex-driver',
          secretRef: { name: 'flex-secret' },
          options: { key: 'flex-opt-val' },
        },
      },
    }
    const out = sanitizeToYaml(pv)
    expect(out).not.toContain('flex-secret')
    expect(out).not.toContain('flex-opt-val')
    expect(out).toContain('flexVolume')
    expect(out).toContain('example.com/flex-driver')
  })
})

// ── ConfigMap: values hidden ─────────────────────────────────────────────────

describe('sanitizeToYaml - ConfigMap', () => {
  it('hides data values but keeps keys', () => {
    const cm = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'cfg', namespace: 'ns' },
      data: { db_url: 'postgres://user:pw@host/db' },
    }
    const out = sanitizeToYaml(cm)
    expect(out).not.toContain('postgres://')
    expect(out).toContain('db_url')
    expect(out).toContain('[hidden]')
  })

  it('nulls binaryData entirely', () => {
    const cm = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'cfg2', namespace: 'ns' },
      data: {},
      binaryData: { cert: 'base64stuff' },
    }
    const out = sanitizeToYaml(cm)
    expect(out).not.toContain('base64stuff')
  })
})

// ── large-map truncation (annotations) ─────────────────────────────────────

describe('sanitizeToYaml - large annotation truncation', () => {
  it('truncates annotation values over 2000 chars', () => {
    const long = 'x'.repeat(2100)
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'p-long',
        namespace: 'ns',
        annotations: { 'description': long },
      },
      spec: { containers: [{ name: 'c1' }] },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain(long)
    expect(out).toContain('[truncated]')
  })
})

// ── pod: StorageOS volume ───────────────────────────────────────────────────

describe('sanitizeToYaml - StorageOS pod volume', () => {
  it('zeroes storageos source so secretRef does not leak', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-sos', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-sos-vol',
          storageos: { volumeName: 'v', secretRef: { name: 'storageos-api-secret' } },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('storageos-api-secret')
    expect(out).toContain('my-sos-vol')
  })
})

// ── PV: StorageOS source ────────────────────────────────────────────────────

describe('sanitizeToYaml - PV StorageOS source', () => {
  it('redacts storageos secretRef so it does not leak', () => {
    const pv = {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: { name: 'pv-sos' },
      spec: {
        storageos: { secretRef: { name: 'pv-storageos-secret' } },
      },
    }
    const out = sanitizeToYaml(pv)
    expect(out).not.toContain('pv-storageos-secret')
    expect(out).toContain('storageos')
  })
})

// ── pod: Cinder volume ──────────────────────────────────────────────────────

describe('sanitizeToYaml - Cinder pod volume', () => {
  it('redacts cinder secretRef so it does not leak', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-cinder', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-cinder-vol',
          cinder: { volumeID: 'cinder-vol-secret-id', secretRef: { name: 'cinder-secret' } },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('cinder-secret')
    expect(out).not.toContain('cinder-vol-secret-id')
    expect(out).toContain('my-cinder-vol')
  })
})

// ── pod: ScaleIO volume ─────────────────────────────────────────────────────

describe('sanitizeToYaml - ScaleIO pod volume', () => {
  it('redacts scaleIO secretRef name', () => {
    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'p-scaleio', namespace: 'ns' },
      spec: {
        containers: [{ name: 'c1' }],
        volumes: [{
          name: 'my-scaleio-vol',
          scaleIO: {
            gateway: 'https://scaleio.internal',
            system: 'scaleio-sys',
            volumeName: 'scaleio-vol',
            secretRef: { name: 'scaleio-secret' },
          },
        }],
      },
    }
    const out = sanitizeToYaml(pod)
    expect(out).not.toContain('scaleio-secret')
    expect(out).toContain('[redacted]')
    expect(out).toContain('my-scaleio-vol')
  })
})

// ── non-K8s objects pass through ───────────────────────────────────────────

describe('sanitizeToYaml - passthrough', () => {
  it('serializes plain objects without error', () => {
    const obj = { foo: 'bar', nested: { x: 1 } }
    const out = sanitizeToYaml(obj)
    expect(out).toContain('foo')
    expect(out).toContain('bar')
  })
})
