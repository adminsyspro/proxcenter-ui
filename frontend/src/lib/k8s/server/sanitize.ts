/**
 * Server-only. Ports /internal/kubernetes/sanitize.go.
 * Redacts the structured JS object first, then serializes to YAML.
 */
import { stringify } from 'yaml'
import { isSensitiveAnnotationKey } from './detail'

export { isSensitiveAnnotationKey }

/** Drops sensitive annotation keys, truncates long values. Returns {} for null/undefined. */
export function filterAnnotations(
  m: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) {
    if (isSensitiveAnnotationKey(k)) continue
    out[k] = v.length > 2000 ? v.slice(0, 2000) + '...[truncated]' : v
  }
  return out
}

// ── env redaction ─────────────────────────────────────────────────────────

function redactEnvList(envs: any[] | undefined): void {
  if (!Array.isArray(envs)) return
  for (const e of envs) {
    if (e && typeof e.value === 'string' && e.value !== '') {
      e.value = '[redacted]'
    }
  }
}

function redactContainerEnvs(containers: any[] | undefined): void {
  if (!Array.isArray(containers)) return
  for (const c of containers) {
    redactEnvList(c.env)
  }
}

// ── pod volume redaction ──────────────────────────────────────────────────

function redactPodVolumes(spec: any): void {
  if (!Array.isArray(spec.volumes)) return
  for (const v of spec.volumes) {
    if (v.secret != null) {
      v.secret = { secretName: '[redacted]' }
    }
    if (v.configMap != null) {
      v.configMap = { name: '[redacted]' }
    }
    if (v.projected != null) {
      v.projected = {}
    }
    if (v.csi != null) {
      v.csi = { driver: v.csi.driver }
    }
    if (v.flexVolume != null) {
      v.flexVolume = { driver: v.flexVolume.driver }
    }
    if (v.azureFile != null) {
      v.azureFile = { secretName: '[redacted]', shareName: '[redacted]' }
    }
    if (v.storageos != null) {
      v.storageos = {}
    }
    if (v.cephfs != null) {
      v.cephfs = { monitors: ['[redacted]'] }
    }
    if (v.iscsi != null) {
      v.iscsi = { targetPortal: '[redacted]', iqn: '[redacted]', lun: 0 }
    }
    if (v.rbd != null) {
      v.rbd = { rbdImage: '[redacted]' }
    }
    if (v.hostPath != null) {
      v.hostPath = { path: '[redacted]' }
    }
    if (v.fc != null) {
      v.fc = {}
    }
    if (v.glusterfs != null) {
      v.glusterfs = { endpoints: '[redacted]', path: '[redacted]' }
    }
    if (v.gcePersistentDisk != null) {
      v.gcePersistentDisk = { pdName: '[redacted]' }
    }
    if (v.awsElasticBlockStore != null) {
      v.awsElasticBlockStore = { volumeID: '[redacted]' }
    }
    if (v.cinder != null) {
      v.cinder = { volumeID: '[redacted]' }
    }
    if (v.scaleIO != null) {
      v.scaleIO = { gateway: '[redacted]', system: '[redacted]', volumeName: '[redacted]', secretRef: { name: '[redacted]' } }
    }
    if (v.nfs != null) {
      v.nfs = { server: '[redacted]', path: '[redacted]' }
    }
    if (v.azureDisk != null) {
      v.azureDisk = { diskName: '[redacted]', diskURI: '[redacted]' }
    }
    if (v.quobyte != null) {
      v.quobyte = { registry: '[redacted]', volume: '[redacted]' }
    }
    if (v.photonPersistentDisk != null) {
      v.photonPersistentDisk = { pdID: '[redacted]' }
    }
    if (v.portworxVolume != null) {
      v.portworxVolume = { volumeID: '[redacted]' }
    }
    if (v.vsphereVolume != null) {
      v.vsphereVolume = { volumePath: '[redacted]' }
    }
    if (v.flocker != null) {
      v.flocker = {}
    }
  }
}

// ── PV source redaction ────────────────────────────────────────────────────

function redactPVSource(spec: any): void {
  if (spec.gcePersistentDisk != null) {
    spec.gcePersistentDisk = { pdName: '[redacted]' }
  }
  if (spec.awsElasticBlockStore != null) {
    spec.awsElasticBlockStore = { volumeID: '[redacted]' }
  }
  if (spec.hostPath != null) {
    spec.hostPath = { path: '[redacted]' }
  }
  if (spec.glusterfs != null) {
    spec.glusterfs = { endpoints: '[redacted]', path: '[redacted]' }
  }
  if (spec.nfs != null) {
    spec.nfs = { server: '[redacted]', path: '[redacted]' }
  }
  if (spec.rbd != null) {
    spec.rbd = { image: '[redacted]' }
  }
  if (spec.iscsi != null) {
    spec.iscsi = { targetPortal: '[redacted]', iqn: '[redacted]', lun: 0 }
  }
  if (spec.cinder != null) {
    spec.cinder = { volumeID: '[redacted]' }
  }
  if (spec.cephfs != null) {
    spec.cephfs = { monitors: ['[redacted]'] }
  }
  if (spec.fc != null) {
    spec.fc = {}
  }
  if (spec.flocker != null) {
    spec.flocker = { datasetName: '[redacted]' }
  }
  if (spec.azureFile != null) {
    spec.azureFile = { secretName: '[redacted]', shareName: '[redacted]' }
  }
  if (spec.vsphereVolume != null) {
    spec.vsphereVolume = { volumePath: '[redacted]' }
  }
  if (spec.quobyte != null) {
    spec.quobyte = { registry: '[redacted]', volume: '[redacted]' }
  }
  if (spec.azureDisk != null) {
    spec.azureDisk = { diskName: '[redacted]', diskURI: '[redacted]' }
  }
  if (spec.photonPersistentDisk != null) {
    spec.photonPersistentDisk = { pdID: '[redacted]' }
  }
  if (spec.portworxVolume != null) {
    spec.portworxVolume = { volumeID: '[redacted]' }
  }
  if (spec.scaleIO != null) {
    spec.scaleIO = { gateway: '[redacted]', system: '[redacted]', volumeName: '[redacted]' }
  }
  if (spec.local != null) {
    spec.local = { path: '[redacted]' }
  }
  if (spec.storageos != null) {
    spec.storageos = { volumeName: '[redacted]' }
  }
  if (spec.csi != null) {
    spec.csi = { driver: spec.csi.driver, volumeHandle: '[redacted]' }
  }
  if (spec.flexVolume != null) {
    spec.flexVolume = { driver: spec.flexVolume.driver }
  }
}

// ── deep clone ─────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ── main export ───────────────────────────────────────────────────────────

/**
 * Redacts the structured JS object first, then serializes to YAML.
 * Input is a plain deserialized K8s object (from @kubernetes/client-node or JSON.parse).
 */
export function sanitizeToYaml(obj: any): string {
  const cp: any = deepClone(obj)
  const kind: string = (cp.kind ?? '').toLowerCase()

  // strip managedFields
  if (cp.metadata) {
    delete cp.metadata.managedFields

    // drop + truncate annotations
    if (cp.metadata.annotations != null) {
      cp.metadata.annotations = filterAnnotations(cp.metadata.annotations)
      if (Object.keys(cp.metadata.annotations).length === 0) {
        delete cp.metadata.annotations
      }
    }
  }

  if (kind === 'pod') {
    const spec = cp.spec ?? {}
    redactContainerEnvs(spec.containers)
    redactContainerEnvs(spec.initContainers)
    redactContainerEnvs(spec.ephemeralContainers)
    redactPodVolumes(spec)
  } else if (kind === 'persistentvolume') {
    if (cp.spec) redactPVSource(cp.spec)
  } else if (kind === 'configmap') {
    const keys: Record<string, string> = {}
    for (const k of Object.keys(cp.data ?? {})) {
      keys[k] = '[hidden]'
    }
    cp.data = keys
    delete cp.binaryData
  }

  return stringify(cp)
}
