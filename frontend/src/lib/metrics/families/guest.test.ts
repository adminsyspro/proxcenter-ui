import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildGuestFamilies } from './guest'

const GUESTS = [
  { connId: 'a', connectionName: 'Alpha', node: 'n1', vmid: '100', name: 'web', type: 'qemu', status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, maxdisk: 32000, uptime: 3600, hastate: 'started', agentEnabled: true, cores: 4, memHost: 1024, netIn: 12345, netOut: 6789, diskRead: 111, diskWritten: 222 },
  { connId: 'a', connectionName: 'Alpha', node: 'n1', vmid: '101', name: 'db', type: 'lxc', status: 'stopped', cpu: 0, mem: 0, maxmem: 0, maxdisk: 0, uptime: 0, hastate: null, agentEnabled: null, cores: 0, memHost: 0, netIn: 0, netOut: 0, diskRead: 0, diskWritten: 0 },
]
const view = { guests: GUESTS } as any
const LABELS = 'connection="Alpha",node="n1",vmid="100",name="web",type="qemu"'
const LABELS_DB = 'connection="Alpha",node="n1",vmid="101",name="db",type="lxc"'

describe('buildGuestFamilies', () => {
  it('keeps the three pre-existing families byte-identical', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_status{${LABELS}} 1`)
    expect(text).toContain(`proxcenter_vm_cpu_usage_ratio{${LABELS}} 0.5`)
    expect(text).toContain('proxcenter_vm_agent_enabled{connection="Alpha",node="n1",vmid="100",name="web"} 1')
  })

  /**
   * agentEnabled is tri-state and null means "we do not know". The whole
   * point of the family is finding agent-less guests, so a null must be
   * OMITTED, never published as a misleading 0.
   *
   * The plan's original assertion here was a brittle multi-line
   * `not.toContain('vmid="101",name="db"} 0\nproxcenter_vm_agent')`: it
   * assumed a line ending in `name="db"} 0` sits immediately before an
   * agent_enabled line, but every other vm family also carries a `type`
   * label, so no such adjacent substring can ever occur regardless of
   * whether the agent sample is (wrongly) emitted. It could never fail.
   * Replaced with a direct count of agent_enabled lines, which tests the
   * same property: the fixture has 2 guests and only 1 known agent flag,
   * so exactly 1 line must be emitted.
   */
  it('still omits the agent sample when the flag is unknown', () => {
    const text = renderExposition(buildGuestFamilies(view))
    const agentLines = text.split('\n').filter(line => line.startsWith('proxcenter_vm_agent_enabled{'))
    expect(agentLines).toHaveLength(1)
  })

  it('publishes guest memory as a ratio and in bytes', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_mem_usage_ratio{${LABELS}} 0.25`)
    expect(text).toContain(`proxcenter_vm_mem_bytes{${LABELS}} 500`)
    expect(text).toContain(`proxcenter_vm_mem_total_bytes{${LABELS}} 2000`)
  })

  it('never emits NaN for a stopped guest with no memory allocation reported', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).not.toContain('NaN')
  })

  it('reports uptime', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_uptime_seconds{${LABELS}} 3600`)
  })

  it('emits HA state as a state set only for guests HA actually manages', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_ha_state{${LABELS},state="started"} 1`)
    expect(text).toContain(`proxcenter_vm_ha_state{${LABELS},state="error"} 0`)
    expect(text).not.toContain('vmid="101",name="db",type="lxc",state=')
  })

  /**
   * A state Proxmox may add later must not become a new label value: the
   * set is bounded and anything outside it lands on `other`.
   */
  it('folds an unrecognised HA state into other rather than inventing a label value', () => {
    const text = renderExposition(buildGuestFamilies({ guests: [{ ...GUESTS[0], hastate: 'freshly_invented' }] } as any))
    expect(text).toContain(`proxcenter_vm_ha_state{${LABELS},state="other"} 1`)
  })

  it('publishes vCPU cores and host-side memory as gauges', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_cpu_cores{${LABELS}} 4`)
    expect(text).toContain(`proxcenter_vm_mem_host_bytes{${LABELS}} 1024`)
  })

  /**
   * memHost is 0 for every container (PVE 9 reports none), and the whole
   * point of publishing it is telling that apart from a missing sample: a
   * builder that skips falsy values would silently drop every LXC from this
   * series.
   */
  it('still renders a container reporting zero host memory rather than omitting the sample', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_mem_host_bytes{${LABELS_DB}} 0`)
  })

  /**
   * netIn/netOut/diskRead/diskWritten are cumulative counters since guest
   * start (#925): the raw value must be published as-is, never a delta or a
   * rate, since Prometheus computes rates itself and needs the raw counter
   * to detect a reset when a guest restarts.
   */
  it('publishes the four network/disk counters at their raw cumulative value, never a delta', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain(`proxcenter_vm_network_receive_bytes_total{${LABELS}} 12345`)
    expect(text).toContain(`proxcenter_vm_network_transmit_bytes_total{${LABELS}} 6789`)
    expect(text).toContain(`proxcenter_vm_disk_read_bytes_total{${LABELS}} 111`)
    expect(text).toContain(`proxcenter_vm_disk_written_bytes_total{${LABELS}} 222`)
  })

  /**
   * The whole point of #925's counter split: these four series must render
   * as Prometheus counters, not the default gauge, or `rate()` mishandles a
   * guest restart's reset to zero.
   */
  it('declares the four byte counters as Prometheus counters, not gauges', () => {
    const text = renderExposition(buildGuestFamilies(view))
    expect(text).toContain('# TYPE proxcenter_vm_network_receive_bytes_total counter')
    expect(text).toContain('# TYPE proxcenter_vm_network_transmit_bytes_total counter')
    expect(text).toContain('# TYPE proxcenter_vm_disk_read_bytes_total counter')
    expect(text).toContain('# TYPE proxcenter_vm_disk_written_bytes_total counter')
  })
})
