import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildNodeFamilies } from './node'

const NODES = [
  { connId: 'a', connectionName: 'Alpha', node: 'n1', status: 'online', cpu: 0.256789, mem: 1000, maxmem: 4000, disk: 3000, maxdisk: 10000, uptime: 86400, maintenance: true },
  { connId: 'a', connectionName: 'Alpha', node: 'n2', status: 'offline', cpu: 0, mem: 0, maxmem: 0, disk: 0, maxdisk: 0, uptime: 0, maintenance: false },
]
const view = { nodes: NODES } as any

describe('buildNodeFamilies', () => {
  it('keeps the three pre-existing families byte-identical', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_online{connection="Alpha",node="n1"} 1')
    expect(text).toContain('proxcenter_node_online{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_cpu_usage_ratio{connection="Alpha",node="n1"} 0.2568')
    expect(text).toContain('proxcenter_node_mem_usage_ratio{connection="Alpha",node="n1"} 0.25')
  })

  it('publishes memory in bytes alongside the ratio, so a panel can show headroom', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_mem_bytes{connection="Alpha",node="n1"} 1000')
    expect(text).toContain('proxcenter_node_mem_total_bytes{connection="Alpha",node="n1"} 4000')
  })

  it('names the root filesystem ratio for what it is', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_rootfs_usage_ratio{connection="Alpha",node="n1"} 0.3')
    expect(text).toMatch(/# HELP proxcenter_node_rootfs_usage_ratio .*NOT cluster storage capacity/)
  })

  /**
   * An offline node reports maxmem and maxdisk 0. A ratio must then be 0,
   * never NaN: a NaN in the exposition makes Prometheus reject the whole
   * scrape, so one dead node would blank every series on the dashboard.
   */
  it('never emits NaN for a node reporting a zero capacity', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).not.toContain('NaN')
    expect(text).toContain('proxcenter_node_mem_usage_ratio{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_rootfs_usage_ratio{connection="Alpha",node="n2"} 0')
  })

  it('reports uptime and maintenance', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_uptime_seconds{connection="Alpha",node="n1"} 86400')
    expect(text).toContain('proxcenter_node_maintenance{connection="Alpha",node="n1"} 1')
    expect(text).toContain('proxcenter_node_maintenance{connection="Alpha",node="n2"} 0')
  })
})
