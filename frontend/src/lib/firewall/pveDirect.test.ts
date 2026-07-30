import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// pveDirect mirrors the orchestrator's firewall service against a stubbed
// pveFetch so we never hit the wire. What matters here is (1) the bare
// response shapes, (2) the form bodies matching the Go ruleToForm /
// updateRuleToForm field for field, (3) the multi-request functions
// (getIPSets, getSecurityGroups, getFirewallStatus, toggleVMNICFirewall).
// ---------------------------------------------------------------------------

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn(),
}))

import { pveFetch } from '@/lib/proxmox/client'

import {
  getAliases,
  createAlias,
  updateAlias,
  deleteAlias,
  getIPSets,
  createIPSet,
  deleteIPSet,
  addIPSetEntry,
  deleteIPSetEntry,
  getSecurityGroups,
  createSecurityGroup,
  deleteSecurityGroup,
  addSecurityGroupRule,
  updateSecurityGroupRule,
  deleteSecurityGroupRule,
  getClusterRules,
  addClusterRule,
  updateClusterRule,
  deleteClusterRule,
  getClusterOptions,
  updateClusterOptions,
  getNodeOptions,
  updateNodeOptions,
  getNodeRules,
  addNodeRule,
  updateNodeRule,
  deleteNodeRule,
  getVMOptions,
  updateVMOptions,
  getVMRules,
  addVMRule,
  updateVMRule,
  deleteVMRule,
  getVMFirewallLog,
  toggleVMNICFirewall,
  getFirewallStatus,
} from './pveDirect'

const conn = { id: 'c1', baseUrl: 'https://pve:8006', apiToken: 'user@pve!t=s', insecureDev: false, behindProxy: false } as any

const mockPve = vi.mocked(pveFetch)

/** [path, init] of the pveFetch call at `index` (default: the last one). */
function callAt(index?: number): { path: string; init: any } {
  const calls = mockPve.mock.calls
  const call = calls[index ?? calls.length - 1]

  expect(call[0]).toBe(conn)

  return { path: call[1] as string, init: call[2] }
}

function formOf(init: any): URLSearchParams {
  expect(init?.body).toBeInstanceOf(URLSearchParams)

  return init.body as URLSearchParams
}

beforeEach(() => {
  mockPve.mockReset()
  mockPve.mockResolvedValue(null as any)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Bare shapes
// ---------------------------------------------------------------------------

describe('bare response shapes', () => {
  it('list reads return the PVE array as-is, never wrapped in { data }', async () => {
    const rules = [{ pos: 0, type: 'in', action: 'ACCEPT', enable: 1 }]

    mockPve.mockResolvedValue(rules as any)

    const result = await getClusterRules(conn)

    expect(result).toBe(rules)
    expect(Array.isArray(result)).toBe(true)
    expect(callAt()).toMatchObject({ path: '/cluster/firewall/rules', init: undefined })
  })

  it('list reads coalesce a null PVE payload to an empty array', async () => {
    expect(await getAliases(conn)).toEqual([])
    expect(await getNodeRules(conn, 'pve1')).toEqual([])
    expect(await getVMRules(conn, 'pve1', 'qemu', 100)).toEqual([])
    expect(await getVMFirewallLog(conn, 'pve1', 'qemu', 100)).toEqual([])
  })

  it('writes resolve to the orchestrator handler body', async () => {
    expect(await createAlias(conn, { name: 'web', cidr: '10.0.0.0/24' })).toEqual({ status: 'created' })
    expect(await updateAlias(conn, 'web', { cidr: '10.0.0.0/16' })).toEqual({ status: 'updated' })
    expect(await deleteAlias(conn, 'web')).toEqual({ status: 'deleted' })
  })
})

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

describe('aliases', () => {
  it('getAliases hits /cluster/firewall/aliases', async () => {
    await getAliases(conn)

    expect(callAt().path).toBe('/cluster/firewall/aliases')
  })

  it('createAlias POSTs name+cidr as a form, omitting an absent comment', async () => {
    await createAlias(conn, { name: 'web', cidr: '10.0.0.0/24' })

    const { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/aliases')
    expect(init.method).toBe('POST')

    const form = formOf(init)

    expect(form.get('name')).toBe('web')
    expect(form.get('cidr')).toBe('10.0.0.0/24')
    expect(form.has('comment')).toBe(false)
  })

  it('updateAlias PUTs cidr (+comment) to the named alias', async () => {
    await updateAlias(conn, 'web', { cidr: '10.1.0.0/24', comment: 'lan' })

    const { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/aliases/web')
    expect(init.method).toBe('PUT')
    expect(formOf(init).get('cidr')).toBe('10.1.0.0/24')
    expect(formOf(init).get('comment')).toBe('lan')
  })

  it('deleteAlias DELETEs the named alias', async () => {
    await deleteAlias(conn, 'web')

    const { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/aliases/web')
    expect(init.method).toBe('DELETE')
  })
})

// ---------------------------------------------------------------------------
// Rule form building (Go ruleToForm / updateRuleToForm)
// ---------------------------------------------------------------------------

describe('rule creation form (ruleToForm)', () => {
  it('always sends type, action and enable; defaults absent enable to 1', async () => {
    await addClusterRule(conn, { type: 'in', action: 'ACCEPT' })

    const { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/rules')
    expect(init.method).toBe('POST')

    const form = formOf(init)

    expect(form.get('type')).toBe('in')
    expect(form.get('action')).toBe('ACCEPT')
    expect(form.get('enable')).toBe('1')
  })

  it('honours an explicit enable: 0 (intentional divergence from the Go coercion)', async () => {
    await addClusterRule(conn, { type: 'in', action: 'ACCEPT', enable: 0 })

    expect(formOf(callAt().init).get('enable')).toBe('0')
  })

  it('omits every optional field left absent, including pos: 0', async () => {
    await addClusterRule(conn, { type: 'in', action: 'ACCEPT', pos: 0 })

    const form = formOf(callAt().init)

    for (const key of ['source', 'dest', 'proto', 'dport', 'sport', 'macro', 'group', 'iface', 'log', 'comment', 'pos']) {
      expect(form.has(key)).toBe(false)
    }
  })

  it('sends every optional field when provided', async () => {
    await addVMRule(conn, 'pve1', 'qemu', 100, {
      type: 'in',
      action: 'ACCEPT',
      enable: 1,
      source: '10.0.0.1',
      dest: '10.0.0.2',
      proto: 'tcp',
      dport: '443',
      sport: '1024',
      macro: 'HTTPS',
      group: 'sg-web',
      iface: 'net0',
      log: 'nolog',
      comment: 'allow https',
      pos: 2,
    })

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/qemu/100/firewall/rules')

    const form = formOf(init)

    expect(form.get('source')).toBe('10.0.0.1')
    expect(form.get('dest')).toBe('10.0.0.2')
    expect(form.get('proto')).toBe('tcp')
    expect(form.get('dport')).toBe('443')
    expect(form.get('sport')).toBe('1024')
    expect(form.get('macro')).toBe('HTTPS')
    expect(form.get('group')).toBe('sg-web')
    expect(form.get('iface')).toBe('net0')
    expect(form.get('log')).toBe('nolog')
    expect(form.get('comment')).toBe('allow https')
    expect(form.get('pos')).toBe('2')
  })
})

describe('rule update form (updateRuleToForm)', () => {
  it('sends only the provided fields, keeping pointer semantics for enable', async () => {
    await updateVMRule(conn, 'pve1', 'qemu', 100, 3, { enable: 0 })

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/qemu/100/firewall/rules/3')
    expect(init.method).toBe('PUT')

    const form = formOf(init)

    expect(form.get('enable')).toBe('0')
    expect(form.has('type')).toBe(false)
    expect(form.has('action')).toBe(false)
    expect(form.has('moveto')).toBe(false)
  })

  it('omits enable when absent and includes moveto when provided (even 0)', async () => {
    await updateClusterRule(conn, 5, { moveto: 0 })

    const form = formOf(callAt().init)

    expect(form.has('enable')).toBe(false)
    expect(form.get('moveto')).toBe('0')
  })

  it('routes security group rule updates to the group path', async () => {
    await updateSecurityGroupRule(conn, 'sg-web', 1, { action: 'DROP' })

    const { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/groups/sg-web/1')
    expect(formOf(init).get('action')).toBe('DROP')
  })

  it('routes node rule updates and deletes to the node path', async () => {
    await updateNodeRule(conn, 'pve1', 2, { comment: 'edited' })

    expect(callAt().path).toBe('/nodes/pve1/firewall/rules/2')

    await deleteNodeRule(conn, 'pve1', 2)

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/firewall/rules/2')
    expect(init.method).toBe('DELETE')
  })

  it('deletes cluster, group and VM rules by position', async () => {
    await deleteClusterRule(conn, 4)
    expect(callAt().path).toBe('/cluster/firewall/rules/4')

    await deleteSecurityGroupRule(conn, 'sg-web', 0)
    expect(callAt().path).toBe('/cluster/firewall/groups/sg-web/0')

    await deleteVMRule(conn, 'pve1', 'lxc', 200, 1)
    expect(callAt().path).toBe('/nodes/pve1/lxc/200/firewall/rules/1')
  })
})

// ---------------------------------------------------------------------------
// Options (pointer semantics of UpdateOptionsRequest)
// ---------------------------------------------------------------------------

describe('options', () => {
  it('reads cluster/node/VM options from the matching PVE paths', async () => {
    mockPve.mockResolvedValue({ enable: 1 } as any)

    expect(await getClusterOptions(conn)).toEqual({ enable: 1 })
    expect(callAt().path).toBe('/cluster/firewall/options')

    await getNodeOptions(conn, 'pve1')
    expect(callAt().path).toBe('/nodes/pve1/firewall/options')

    await getVMOptions(conn, 'pve1', 'lxc', 200)
    expect(callAt().path).toBe('/nodes/pve1/lxc/200/firewall/options')
  })

  it('sends only the provided option fields, including explicit zeros', async () => {
    await updateNodeOptions(conn, 'pve1', { enable: 0, policy_in: 'DROP' })

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/firewall/options')
    expect(init.method).toBe('PUT')

    const form = formOf(init)

    expect(form.get('enable')).toBe('0')
    expect(form.get('policy_in')).toBe('DROP')
    expect(form.has('policy_out')).toBe(false)
    expect(form.has('log_level_in')).toBe(false)
    expect(form.has('log_level_out')).toBe(false)
  })

  it('updates cluster and VM options on their own paths', async () => {
    await updateClusterOptions(conn, { enable: 1 })
    expect(callAt().path).toBe('/cluster/firewall/options')

    await updateVMOptions(conn, 'pve1', 'qemu', 100, { log_level_in: 'info' })

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/qemu/100/firewall/options')
    expect(formOf(init).get('log_level_in')).toBe('info')
  })
})

// ---------------------------------------------------------------------------
// IP sets (member enrichment)
// ---------------------------------------------------------------------------

describe('IP sets', () => {
  it('getIPSets loads members per set and survives one set failing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockPve.mockImplementation(async (_c, path) => {
      if (path === '/cluster/firewall/ipset') return [{ name: 'good' }, { name: 'bad' }] as any
      if (path === '/cluster/firewall/ipset/good') return [{ cidr: '1.2.3.4' }] as any
      throw new Error('PVE 500')
    })

    const ipsets = await getIPSets(conn)

    expect(ipsets).toEqual([
      { name: 'good', members: [{ cidr: '1.2.3.4' }] },
      { name: 'bad' },
    ])
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('createIPSet / deleteIPSet / entries use the ipset paths and form bodies', async () => {
    await createIPSet(conn, { name: 'blocklist', comment: 'bad ips' })

    let { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/ipset')
    expect(init.method).toBe('POST')
    expect(formOf(init).get('name')).toBe('blocklist')
    expect(formOf(init).get('comment')).toBe('bad ips')

    await addIPSetEntry(conn, 'blocklist', { cidr: '10.9.8.0/24', nomatch: true })
    ;({ path, init } = callAt())

    expect(path).toBe('/cluster/firewall/ipset/blocklist')
    expect(formOf(init).get('cidr')).toBe('10.9.8.0/24')
    expect(formOf(init).get('nomatch')).toBe('1')

    await addIPSetEntry(conn, 'blocklist', { cidr: '10.9.9.1' })
    expect(formOf(callAt().init).has('nomatch')).toBe(false)

    expect(await deleteIPSet(conn, 'blocklist')).toEqual({ status: 'deleted' })
    expect(callAt().path).toBe('/cluster/firewall/ipset/blocklist')
  })

  it('deleteIPSetEntry escapes the CIDR slash like the Go url.PathEscape', async () => {
    expect(await deleteIPSetEntry(conn, 'blocklist', '10.9.8.0/24')).toEqual({ status: 'deleted' })

    const { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/ipset/blocklist/10.9.8.0%2F24')
    expect(init.method).toBe('DELETE')
  })
})

// ---------------------------------------------------------------------------
// Security groups (rule enrichment)
// ---------------------------------------------------------------------------

describe('security groups', () => {
  it('getSecurityGroups loads rules per group and survives one group failing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockPve.mockImplementation(async (_c, path) => {
      if (path === '/cluster/firewall/groups') return [{ group: 'sg-web' }, { group: 'sg-db' }] as any
      if (path === '/cluster/firewall/groups/sg-web') return [{ pos: 0, type: 'in', action: 'ACCEPT' }] as any
      throw new Error('PVE 500')
    })

    const groups = await getSecurityGroups(conn)

    expect(groups).toEqual([
      { group: 'sg-web', rules: [{ pos: 0, type: 'in', action: 'ACCEPT' }] },
      { group: 'sg-db' },
    ])
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('create/delete group and add rule hit the groups paths', async () => {
    await createSecurityGroup(conn, { group: 'sg-web' })

    let { path, init } = callAt()

    expect(path).toBe('/cluster/firewall/groups')
    expect(formOf(init).get('group')).toBe('sg-web')
    expect(formOf(init).has('comment')).toBe(false)

    await addSecurityGroupRule(conn, 'sg-web', { type: 'in', action: 'ACCEPT' })
    ;({ path, init } = callAt())

    expect(path).toBe('/cluster/firewall/groups/sg-web')
    expect(init.method).toBe('POST')
    expect(formOf(init).get('enable')).toBe('1')

    expect(await deleteSecurityGroup(conn, 'sg-web')).toEqual({ status: 'deleted' })
    expect(callAt().path).toBe('/cluster/firewall/groups/sg-web')
  })
})

// ---------------------------------------------------------------------------
// Node rules
// ---------------------------------------------------------------------------

describe('node rules', () => {
  it('reads and creates node rules on the node path', async () => {
    await getNodeRules(conn, 'pve1')
    expect(callAt().path).toBe('/nodes/pve1/firewall/rules')

    await addNodeRule(conn, 'pve1', { type: 'in', action: 'DROP' })

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/firewall/rules')
    expect(init.method).toBe('POST')
  })
})

// ---------------------------------------------------------------------------
// VM firewall log
// ---------------------------------------------------------------------------

describe('getVMFirewallLog', () => {
  it('defaults the limit to 50', async () => {
    await getVMFirewallLog(conn, 'pve1', 'qemu', 100)

    expect(callAt().path).toBe('/nodes/pve1/qemu/100/firewall/log?limit=50')
  })

  it('passes an explicit limit through', async () => {
    mockPve.mockResolvedValue([{ n: 1, t: 'line' }] as any)

    expect(await getVMFirewallLog(conn, 'pve1', 'lxc', 200, 200)).toEqual([{ n: 1, t: 'line' }])
    expect(callAt().path).toBe('/nodes/pve1/lxc/200/firewall/log?limit=200')
  })
})

// ---------------------------------------------------------------------------
// NIC firewall toggle (config read/rewrite)
// ---------------------------------------------------------------------------

describe('toggleVMNICFirewall', () => {
  it('rewrites every netX with firewall=1, driver key first', async () => {
    mockPve.mockImplementation(async (_c, path, init) => {
      if (path === '/nodes/pve1/qemu/100/config' && !init?.method) {
        return {
          name: 'vm100',
          net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
          net1: 'e1000=11:22:33:44:55:66,bridge=vmbr1,firewall=0,tag=42',
          scsi0: 'local:vm-100-disk-0,size=32G',
        } as any
      }

      return null as any
    })

    expect(await toggleVMNICFirewall(conn, 'pve1', 'qemu', 100, true)).toEqual({ status: 'updated' })
    expect(mockPve).toHaveBeenCalledTimes(2)

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/qemu/100/config')
    expect(init.method).toBe('PUT')

    const form = formOf(init)

    expect(form.get('net0')).toBe('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1')
    expect(form.get('net1')).toBe('e1000=11:22:33:44:55:66,bridge=vmbr1,firewall=1,tag=42')
    expect(form.has('scsi0')).toBe(false)
    expect(form.has('name')).toBe(false)
  })

  it('disables with firewall=0 and uses the lxc config path for containers', async () => {
    mockPve.mockImplementation(async (_c, path, init) => {
      if (path === '/nodes/pve1/lxc/200/config' && !init?.method) {
        return { net0: 'name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:FF,firewall=1,ip=dhcp' } as any
      }

      return null as any
    })

    await toggleVMNICFirewall(conn, 'pve1', 'lxc', 200, false)

    const { path, init } = callAt()

    expect(path).toBe('/nodes/pve1/lxc/200/config')

    // Primary keys (name, hwaddr) first, then the rest in config order
    expect(formOf(init).get('net0')).toBe('name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=0,ip=dhcp')
  })

  it('is a no-op success when the guest has no NICs', async () => {
    mockPve.mockResolvedValue({ name: 'diskless', scsi0: 'local:vm-1-disk-0' } as any)

    expect(await toggleVMNICFirewall(conn, 'pve1', 'qemu', 100, true)).toEqual({ status: 'updated' })

    // Only the config GET — no PUT was issued
    expect(mockPve).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Firewall status (aggregation)
// ---------------------------------------------------------------------------

describe('getFirewallStatus', () => {
  it('aggregates counts and protection like the Go service', async () => {
    mockPve.mockImplementation(async (_c, path) => {
      switch (path) {
        case '/cluster/firewall/options': return { enable: 1 } as any
        case '/cluster/firewall/aliases': return [{ name: 'a' }, { name: 'b' }] as any
        case '/cluster/firewall/ipset': return [] as any
        case '/cluster/firewall/groups': return [{ group: 'sg-web' }] as any
        case '/cluster/firewall/groups/sg-web': return [] as any
        case '/cluster/firewall/rules': return [{ pos: 0 }] as any
        case '/nodes': return [{ node: 'pve1' }, { node: 'pve2' }] as any
        case '/nodes/pve1/firewall/options': return { enable: 1 } as any
        case '/nodes/pve2/firewall/options': return { enable: 0 } as any
        case '/cluster/resources?type=vm':
          return [
            { vmid: 100, node: 'pve1', type: 'qemu' },
            { vmid: 200, node: 'pve1', type: 'lxc' },
          ] as any
        case '/nodes/pve1/qemu/100/firewall/options': return { enable: 1 } as any
        case '/nodes/pve1/lxc/200/firewall/options': throw new Error('PVE 500')
        default: throw new Error(`unexpected path ${path}`)
      }
    })

    expect(await getFirewallStatus(conn)).toEqual({
      cluster_enabled: true,
      status: 'enabled/running',
      total_aliases: 2,
      total_ipsets: 0,
      total_groups: 1,
      total_cluster_rules: 1,
      protected_nodes: 1,
      total_nodes: 2,
      protected_vms: 1,
      total_vms: 2,
    })
  })

  it('never throws: a fully unreachable cluster yields the zeroed status', async () => {
    mockPve.mockRejectedValue(new Error('PVE connection c1: all cluster nodes unreachable'))

    expect(await getFirewallStatus(conn)).toEqual({
      cluster_enabled: false,
      status: 'disabled',
      total_aliases: 0,
      total_ipsets: 0,
      total_groups: 0,
      total_cluster_rules: 0,
      protected_nodes: 0,
      total_nodes: 0,
      protected_vms: 0,
      total_vms: 0,
    })
  })
})
