import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildClusterFamilies } from './cluster'

const view = {
  clusters: [
    { id: 'a', name: 'Alpha', type: 'pve', status: 'online', cephHealth: 'HEALTH_WARN' },
    { id: 'b', name: 'Beta', type: 'pve', status: 'degraded' },
    { id: 'c', name: 'Gamma', type: 'pve', status: 'offline', cephHealth: 'HEALTH_OK' },
  ],
} as any

describe('buildClusterFamilies', () => {
  it('reports reachability and degradation as independent booleans', () => {
    const text = renderExposition(buildClusterFamilies(view))
    expect(text).toContain('proxcenter_cluster_up{connection="Alpha",type="pve"} 1')
    expect(text).toContain('proxcenter_cluster_up{connection="Beta",type="pve"} 0')
    expect(text).toContain('proxcenter_cluster_degraded{connection="Beta"} 1')
    expect(text).toContain('proxcenter_cluster_degraded{connection="Alpha"} 0')
  })

  /**
   * A degraded cluster is NOT up: `status` is a single tri-state, so a
   * consumer counting `sum(proxcenter_cluster_up)` must not be handed a 1
   * for a cluster that lost quorum.
   */
  it('does not count a degraded cluster as up', () => {
    const text = renderExposition(buildClusterFamilies(view))
    expect(text).not.toContain('proxcenter_cluster_up{connection="Beta",type="pve"} 1')
  })

  it('emits Ceph health as a state set with exactly one active state', () => {
    const text = renderExposition(buildClusterFamilies(view))
    expect(text).toContain('proxcenter_cluster_ceph_health{connection="Alpha",health="warn"} 1')
    expect(text).toContain('proxcenter_cluster_ceph_health{connection="Alpha",health="ok"} 0')
    expect(text).toContain('proxcenter_cluster_ceph_health{connection="Alpha",health="err"} 0')
    expect(text).toContain('proxcenter_cluster_ceph_health{connection="Alpha",health="unknown"} 0')
  })

  /**
   * A cluster with no Ceph at all must emit NOTHING for this family, not an
   * `unknown` sample: an `unknown` would inflate any panel counting clusters
   * whose Ceph is not healthy, on installs that have no Ceph to be unhealthy.
   */
  it('omits the Ceph family entirely for a cluster without Ceph', () => {
    const text = renderExposition(buildClusterFamilies(view))
    expect(text).not.toContain('connection="Beta",health=')
  })

  it('maps an unrecognised Ceph string to unknown rather than dropping it', () => {
    const text = renderExposition(buildClusterFamilies([{ clusters: [{ id: 'z', name: 'Zed', type: 'pve', status: 'online', cephHealth: 'SOMETHING_NEW' }] }][0] as any))
    expect(text).toContain('proxcenter_cluster_ceph_health{connection="Zed",health="unknown"} 1')
  })
})
