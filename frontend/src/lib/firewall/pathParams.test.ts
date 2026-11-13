import { describe, expect, it } from 'vitest'

import { FirewallParamError, firewallParamRefusal, firewallResourceType, invalidResourceType, orchestratorAddressSegment, pveSegment } from './pathParams'

const refusalOf = async (params: Parameters<typeof firewallParamRefusal>[0]) => {
  const res = firewallParamRefusal(params)

  return res ? { status: res.status, body: await res.json() } : null
}

describe('firewallParamRefusal', () => {
  it('lets through every value PVE itself accepts', () => {
    const accepted: Array<Parameters<typeof firewallParamRefusal>[0]> = [
      { node: 'pve1' },
      { node: 'pve-node-01.lab_x' },
      { node: 'N' },
      { vmType: 'qemu', vmid: '100' },
      { vmType: 'lxc', vmid: 7001 },
      { vmid: '999999999' },
      { pos: '0' },
      { pos: '12' },
      { pos: 3 },
      { alias: 'web-servers' },
      { alias: 'dmz_net-1' },
      { alias: 'a'.repeat(64) },
      { ipset: 'blacklist' },
      { ipset: 'Mgmt_v6-2' },
      { group: 'sg-web' },
      { group: 'SG_base-01' },
      { address: '10.0.0.1' },
      { address: '10.0.0.0/8' },
      { address: '192.168.1.0/24' },
      { address: 'fd00::1' },
      { address: '::1' },
      { address: '2001:db8::/32' },
      { address: '::ffff:10.0.0.1' },
      { address: 'web-servers' },
      { address: 'dc/web-servers' },
      { address: 'guest/local_net' },
      { node: 'pve1', pos: '4' },
      { ipset: 'blacklist', address: '10.0.0.0/8' },
      {},
    ]

    for (const params of accepted) expect(firewallParamRefusal(params), JSON.stringify(params)).toBeNull()
  })

  it.each([
    ['node', 'Invalid node name', ['', '.', '..', '..\\..\\x', 'pve1/..', 'pve1/lxc/101', 'pve1?x', 'pve1#x', '%2e%2e', 'pve 1', '-pve', 'x'.repeat(64), 42, null, undefined]],
    ['vmType', 'Invalid type', ['', 'kvm', 'qemu/..', 'QEMU', '..', null]],
    ['vmid', 'Invalid vmid', ['', '0', '-1', '1e3', '100/..', '100?x', '0100', '1'.repeat(10), 0, 1.5, null]],
    ['pos', 'Invalid rule position', ['', '-1', '1.5', '0/..', '0\\..', '0?x=1', '0#', '%30', ' 1', 'one', '1'.repeat(10), -1, 1.5, null]],
    ['alias', 'Invalid alias name', ['', '.', '..', 'a b', 'a/b', 'a\\b', 'a?b', 'a#b', '9a', '_a', '-a', '%2e%2e', 'é', 'a'.repeat(65), null]],
    ['ipset', 'Invalid IP set name', ['', '..', 'a/b', '..\\..\\alerts\\none?', 'a%2Fb', '+set', null]],
    ['group', 'Invalid security group name', ['', '..', 'sg web', 'sg/..', 'sg\\..', 'sg?x', null]],
    ['address', 'Invalid address', ['', '.', '..', '../x', '10.0.0.0/..', '10.0.0.0/./8', '10.0.0.0//8', '/8', '10.0.0.0/', '10.0.0.0\\8', '10.0.0.0?x', '10.0.0.0#x', '10.0.0.0%2F8', '10.0.0.0 /8', '.hidden', 'x'.repeat(129), null]],
  ] as const)('refuses a malformed %s with a 400', async (kind, message, values) => {
    for (const value of values) {
      expect(await refusalOf({ [kind]: value }), JSON.stringify(value)).toEqual({ status: 400, body: { error: message } })
    }
  })

  it('names the first malformed parameter', async () => {
    expect(await refusalOf({ node: 'pve1', pos: '..' })).toEqual({ status: 400, body: { error: 'Invalid rule position' } })
    expect(await refusalOf({ node: '..', pos: '..' })).toEqual({ status: 400, body: { error: 'Invalid node name' } })
  })
})

describe('pveSegment', () => {
  it('returns the validated value as one path segment', () => {
    expect(pveSegment('node', 'pve1')).toBe('pve1')
    expect(pveSegment('vmType', 'lxc')).toBe('lxc')
    expect(pveSegment('vmid', 100)).toBe('100')
    expect(pveSegment('pos', 0)).toBe('0')
    expect(pveSegment('pos', '7')).toBe('7')
    expect(pveSegment('group', 'sg-web')).toBe('sg-web')
    expect(pveSegment('address', '10.0.0.0/8')).toBe('10.0.0.0%2F8')
  })

  it('throws a 400-carrying error on anything else', () => {
    for (const [kind, value] of [['node', 'pve1\\..\\pve2'], ['node', 'pve1/lxc/101'], ['vmType', 'qemu/100'], ['vmid', '100/firewall'], ['pos', '0\\..\\..'], ['pos', '0/../..']] as const) {
      expect(() => pveSegment(kind, value), value).toThrow(FirewallParamError)
    }
    try {
      pveSegment('pos', '..')
    } catch (e) {
      expect((e as FirewallParamError).status).toBe(400)
      expect((e as FirewallParamError).message).toBe('Invalid rule position')
    }
  })
})

describe('firewallResourceType', () => {
  it('reads options (the default) or rules, nothing else', () => {
    expect(firewallResourceType(null)).toBe('options')
    expect(firewallResourceType('')).toBe('options')
    expect(firewallResourceType('options')).toBe('options')
    expect(firewallResourceType('rules')).toBe('rules')
    for (const raw of ['Rules', 'rules?x=1', 'rules/..', '..\\..\\notifications\\settings?', '%2e%2e', 'log', ' rules']) {
      expect(firewallResourceType(raw), raw).toBeNull()
    }
  })

  it('has its own 400', async () => {
    const res = invalidResourceType()

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid type' })
  })
})

describe('orchestratorAddressSegment', () => {
  it('keeps an address as is and encodes only the slash', () => {
    expect(orchestratorAddressSegment('10.0.0.1')).toBe('10.0.0.1')
    expect(orchestratorAddressSegment('fd00::1')).toBe('fd00::1')
    expect(orchestratorAddressSegment('10.0.0.0/8')).toBe('10.0.0.0%2F8')
    expect(orchestratorAddressSegment('dc/web-servers')).toBe('dc%2Fweb-servers')
  })

  it('refuses a value outside the address grammar', () => {
    for (const value of ['..', '../x', '10.0.0.0\\8', '10.0.0.0?x', 'a b']) {
      expect(() => orchestratorAddressSegment(value), value).toThrow(FirewallParamError)
    }
  })
})
