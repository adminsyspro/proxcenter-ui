import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildGuestFamilies } from './guest'

const GUESTS = [
  { connId: 'a', connectionName: 'Alpha', node: 'n1', vmid: '100', name: 'web', type: 'qemu', status: 'running', cpu: 0.5, mem: 500, maxmem: 2000, maxdisk: 32000, uptime: 3600, hastate: 'started', agentEnabled: true },
  { connId: 'a', connectionName: 'Alpha', node: 'n1', vmid: '101', name: 'db', type: 'lxc', status: 'stopped', cpu: 0, mem: 0, maxmem: 0, maxdisk: 0, uptime: 0, hastate: null, agentEnabled: null },
]
const view = { guests: GUESTS } as any
const LABELS = 'connection="Alpha",node="n1",vmid="100",name="web",type="qemu"'

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
})
