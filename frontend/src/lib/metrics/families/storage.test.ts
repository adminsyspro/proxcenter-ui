import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildStorageFamilies } from './storage'

const view = {
  storages: [
    // A shared RBD pool: ONE capacity for the whole cluster. Upstream
    // reports it once per node with identical figures; `aggregateStorage`
    // already collapsed it, but the fixture still carries two `nodes`
    // entries to prove this module refuses to re-expand them regardless.
    {
      connId: 'c1', connectionName: 'Cluster One', storage: 'ceph-rbd', type: 'rbd', shared: true,
      used: 4096, total: 8192, enabled: true,
      nodes: [
        { node: 'pve1', used: 4096, total: 8192 },
        { node: 'pve2', used: 4096, total: 8192 },
      ],
    },
    // A non-shared storage genuinely differs per node.
    {
      connId: 'c1', connectionName: 'Cluster One', storage: 'local', type: 'dir', shared: false,
      used: 300, total: 1000, enabled: true,
      nodes: [
        { node: 'pve1', used: 100, total: 1000 },
        { node: 'pve2', used: 300, total: 500 },
      ],
    },
    // Disabled, shared, and reporting zero capacity: a datastore that must
    // still render its enabled flag as 0 and never a NaN ratio.
    {
      connId: 'c1', connectionName: 'Cluster One', storage: 'backup-nfs', type: 'nfs', shared: true,
      used: 0, total: 0, enabled: false,
      nodes: [
        { node: 'pve1', used: 0, total: 0 },
      ],
    },
  ],
} as any

describe('buildStorageFamilies', () => {
  it('publishes cluster-level capacity and usage with connection/storage/type/shared labels', () => {
    const text = renderExposition(buildStorageFamilies(view))
    expect(text).toContain('proxcenter_storage_total_bytes{connection="Cluster One",storage="ceph-rbd",type="rbd",shared="true"} 8192')
    expect(text).toContain('proxcenter_storage_used_bytes{connection="Cluster One",storage="ceph-rbd",type="rbd",shared="true"} 4096')
    expect(text).toContain('proxcenter_storage_usage_ratio{connection="Cluster One",storage="ceph-rbd",type="rbd",shared="true"} 0.5')
    expect(text).toContain('proxcenter_storage_total_bytes{connection="Cluster One",storage="local",type="dir",shared="false"} 1000')
    expect(text).toContain('proxcenter_storage_used_bytes{connection="Cluster One",storage="local",type="dir",shared="false"} 300')
    expect(text).toContain('proxcenter_storage_usage_ratio{connection="Cluster One",storage="local",type="dir",shared="false"} 0.3')
  })

  it('reports enabled state with connection and storage labels only', () => {
    const text = renderExposition(buildStorageFamilies(view))
    expect(text).toContain('proxcenter_storage_enabled{connection="Cluster One",storage="ceph-rbd"} 1')
    expect(text).toContain('proxcenter_storage_enabled{connection="Cluster One",storage="local"} 1')
    expect(text).toContain('proxcenter_storage_enabled{connection="Cluster One",storage="backup-nfs"} 0')
    // No type or shared label leaks onto this family.
    expect(text).not.toContain('proxcenter_storage_enabled{connection="Cluster One",storage="ceph-rbd",type=')
  })

  it('publishes per-node figures for a non-shared storage, which genuinely differ per node', () => {
    const text = renderExposition(buildStorageFamilies(view))
    expect(text).toContain('proxcenter_storage_node_total_bytes{connection="Cluster One",storage="local",node="pve1"} 1000')
    expect(text).toContain('proxcenter_storage_node_used_bytes{connection="Cluster One",storage="local",node="pve1"} 100')
    expect(text).toContain('proxcenter_storage_node_usage_ratio{connection="Cluster One",storage="local",node="pve1"} 0.1')
    expect(text).toContain('proxcenter_storage_node_total_bytes{connection="Cluster One",storage="local",node="pve2"} 500')
    expect(text).toContain('proxcenter_storage_node_used_bytes{connection="Cluster One",storage="local",node="pve2"} 300')
    expect(text).toContain('proxcenter_storage_node_usage_ratio{connection="Cluster One",storage="local",node="pve2"} 0.6')
  })

  /**
   * A shared storage such as a Ceph RBD pool or an NFS export has ONE
   * capacity for the whole cluster, not one per node. Upstream reports it
   * once per node with identical figures, so emitting per-node samples here
   * would let any sum() triple its capacity on a three node cluster (#925).
   */
  it('emits no node-level sample whatsoever for a shared storage', () => {
    const text = renderExposition(buildStorageFamilies(view))
    expect(text).not.toContain('storage="ceph-rbd",node=')
    expect(text).not.toContain('storage="backup-nfs",node=')
    const nodeLines = text
      .split(String.fromCharCode(10))
      .filter(line => line.startsWith('proxcenter_storage_node_'))
    expect(nodeLines.every(line => line.includes('storage="local"'))).toBe(true)
    expect(nodeLines).toHaveLength(6)
  })

  it('serves the ratio pre-computed, so a storage reporting zero capacity never renders NaN', () => {
    const text = renderExposition(buildStorageFamilies(view))
    expect(text).toContain('proxcenter_storage_usage_ratio{connection="Cluster One",storage="backup-nfs",type="nfs",shared="true"} 0')
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('Infinity')
  })

  it('yields empty families rather than throwing when storages is missing', () => {
    const text = renderExposition(buildStorageFamilies({} as any))
    expect(text).toBe('')
  })
})
