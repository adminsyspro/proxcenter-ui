import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildNodeFamilies } from './node'

const NODES = [
  {
    connId: 'a', connectionName: 'Alpha', node: 'n1', status: 'online', cpu: 0.256789, mem: 1000, maxmem: 4000, disk: 3000, maxdisk: 10000, uptime: 86400, maintenance: true,
    load1: 1.5, load5: 1.25, load15: 0.75, iowait: 0.123456, swapUsed: 500, swapTotal: 2000, rootfsUsed: 3000, rootfsTotal: 8000, cores: 8, pveVersion: '9.2.11', kernel: '6.8.0-1-pve',
  },
  {
    connId: 'a', connectionName: 'Alpha', node: 'n2', status: 'offline', cpu: 0, mem: 0, maxmem: 0, disk: 0, maxdisk: 0, uptime: 0, maintenance: false,
    load1: 0, load5: 0, load15: 0, iowait: 0, swapUsed: 0, swapTotal: 0, rootfsUsed: 0, rootfsTotal: 0, cores: 0, pveVersion: null, kernel: null,
  },
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

  it('reports the three load averages as plain numbers', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_load1{connection="Alpha",node="n1"} 1.5')
    expect(text).toContain('proxcenter_node_load5{connection="Alpha",node="n1"} 1.25')
    expect(text).toContain('proxcenter_node_load15{connection="Alpha",node="n1"} 0.75')
  })

  it('rounds iowait to four decimal places', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_iowait_ratio{connection="Alpha",node="n1"} 0.1235')
  })

  it('publishes swap and root filesystem usage in bytes', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_swap_bytes{connection="Alpha",node="n1"} 500')
    expect(text).toContain('proxcenter_node_swap_total_bytes{connection="Alpha",node="n1"} 2000')
    expect(text).toContain('proxcenter_node_rootfs_bytes{connection="Alpha",node="n1"} 3000')
    expect(text).toContain('proxcenter_node_rootfs_total_bytes{connection="Alpha",node="n1"} 8000')
  })

  it('publishes the CPU core count', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain('proxcenter_node_cpu_cores{connection="Alpha",node="n1"} 8')
  })

  it('carries the PVE version and kernel as labels on node info', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).toContain(
      'proxcenter_node_info{connection="Alpha",node="n1",pve_version="9.2.11",kernel="6.8.0-1-pve"} 1',
    )
  })

  /**
   * A node with neither field would otherwise render as a bare
   * connection/node line once renderLabels drops the two null labels --
   * indistinguishable from every OTHER node with no version or kernel
   * reported, colliding on the same series. Omitting the sample entirely
   * avoids that (#925).
   */
  it('omits the info sample when both PVE version and kernel are null', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).not.toContain('proxcenter_node_info{connection="Alpha",node="n2"')
  })

  it('never emits NaN across the new families for a node reporting all zeros', () => {
    const text = renderExposition(buildNodeFamilies(view))
    expect(text).not.toContain('NaN')
    expect(text).toContain('proxcenter_node_load1{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_load5{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_load15{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_iowait_ratio{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_swap_bytes{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_swap_total_bytes{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_rootfs_bytes{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_rootfs_total_bytes{connection="Alpha",node="n2"} 0')
    expect(text).toContain('proxcenter_node_cpu_cores{connection="Alpha",node="n2"} 0')
  })
})
