import { describe, expect, it } from 'vitest'

import { maskedCidr, validateFlowForm, validateZoneForm, ZONE_COLORS } from './zoneForm'

const zone = (over: Partial<Parameters<typeof validateZoneForm>[0]> = {}) => ({
  name: 'web', label: '', color: ZONE_COLORS[0], isolate_members: false, ...over,
})

const flow = (over: Partial<Parameters<typeof validateFlowForm>[0]> = {}) => ({
  src_zone_id: 'a', src_cidr: '', dst_zone_id: 'b', dst_cidr: '', proto: 'tcp', dport: '443', ...over,
})

describe('validateZoneForm', () => {
  it('accepts a lowercase name of 1 to 14 characters', () => {
    expect(validateZoneForm(zone({ name: 'web' }))).toEqual({})
    expect(validateZoneForm(zone({ name: 'a' }))).toEqual({})
    expect(validateZoneForm(zone({ name: 'web-tier-0' }))).toEqual({})
    expect(validateZoneForm(zone({ name: 'abcdefghijklmn' }))).toEqual({})
  })

  it('refuses "Web_1" and a 15 character name', () => {
    expect(validateZoneForm(zone({ name: 'Web_1' })).name).toBe('microsegPilot.policy.validation.nameInvalid')
    expect(validateZoneForm(zone({ name: 'abcdefghijklmno' })).name).toBe('microsegPilot.policy.validation.nameInvalid')
  })

  it('refuses a name that starts with a digit or a dash, and an empty one', () => {
    expect(validateZoneForm(zone({ name: '1web' })).name).toBe('microsegPilot.policy.validation.nameInvalid')
    expect(validateZoneForm(zone({ name: '-web' })).name).toBe('microsegPilot.policy.validation.nameInvalid')
    expect(validateZoneForm(zone({ name: '' })).name).toBe('microsegPilot.policy.validation.nameRequired')
  })

  it('refuses a color that is not a hex code, accepts an empty one', () => {
    expect(validateZoneForm(zone({ color: 'red' })).color).toBe('microsegPilot.policy.validation.colorInvalid')
    expect(validateZoneForm(zone({ color: '' }))).toEqual({})
    expect(validateZoneForm(zone({ color: '#A1b2C3' }))).toEqual({})
  })
})

describe('validateFlowForm', () => {
  it('accepts a zone to zone flow and a zone to CIDR flow', () => {
    expect(validateFlowForm(flow())).toEqual({})
    expect(validateFlowForm(flow({ dst_zone_id: '', dst_cidr: '10.0.0.0/8' }))).toEqual({})
    expect(validateFlowForm(flow({ src_zone_id: '', src_cidr: '2001:db8::/32' }))).toEqual({})
  })

  it('refuses a flow with two CIDR sides', () => {
    const errors = validateFlowForm(flow({ src_zone_id: '', src_cidr: '10.0.0.0/8', dst_zone_id: '', dst_cidr: '192.168.0.0/16' }))
    expect(errors.dst).toBe('microsegPilot.policy.validation.cidrBoth')
  })

  it('refuses a side with nothing, and a side with both a zone and a CIDR', () => {
    expect(validateFlowForm(flow({ src_zone_id: '' })).src).toBe('microsegPilot.policy.validation.sideRequired')
    expect(validateFlowForm(flow({ dst_zone_id: '' })).dst).toBe('microsegPilot.policy.validation.sideRequired')
    expect(validateFlowForm(flow({ dst_cidr: '10.0.0.0/8' })).dst).toBe('microsegPilot.policy.validation.sideBoth')
  })

  it('refuses a malformed CIDR', () => {
    for (const bad of ['10.0.0.0', '10.0.0.0/33', '10.0.0/8', '300.0.0.0/8', '10.0.0.01/24', 'fe80::1/129', 'nope', '10.0.0.0/08', '1::2::3/64']) {
      expect(validateFlowForm(flow({ dst_zone_id: '', dst_cidr: bad })).dst, bad).toBe('microsegPilot.policy.validation.cidrInvalid')
    }
  })

  it('refuses a CIDR with host bits set, IPv4 and IPv6', () => {
    expect(validateFlowForm(flow({ dst_zone_id: '', dst_cidr: '10.0.0.5/24' })).dst).toBe('microsegPilot.policy.validation.cidrHostBits')
    expect(validateFlowForm(flow({ src_zone_id: '', src_cidr: '2001:db8::1/64' })).src).toBe('microsegPilot.policy.validation.cidrHostBits')
    expect(validateFlowForm(flow({ dst_zone_id: '', dst_cidr: '10.1.2.3/32' }))).toEqual({})
    expect(validateFlowForm(flow({ dst_zone_id: '', dst_cidr: '0.0.0.0/0' }))).toEqual({})
  })

  it('accepts tcp and udp with no port, a port, a list and a range', () => {
    for (const dport of ['', '80', '80,443', '8000:8100', '22,8000:8100']) {
      expect(validateFlowForm(flow({ proto: 'udp', dport })), dport).toEqual({})
    }
  })

  it('refuses ports out of range, reversed ranges and garbage', () => {
    for (const dport of ['0', '65536', '80,', ',80', '90:80', '80:', 'http', '80;443', '1:2:3']) {
      expect(validateFlowForm(flow({ dport })).dport, dport).toBe('microsegPilot.policy.validation.portInvalid')
    }
  })

  it('refuses a port with icmp, icmpv6 and any, accepts them without', () => {
    for (const proto of ['icmp', 'icmpv6', 'any']) {
      expect(validateFlowForm(flow({ proto, dport: '80' })).dport, proto).toBe('microsegPilot.policy.validation.portNotAllowed')
      expect(validateFlowForm(flow({ proto, dport: '' })), proto).toEqual({})
    }
  })

  it('refuses an unknown protocol', () => {
    expect(validateFlowForm(flow({ proto: 'gre', dport: '' })).proto).toBe('microsegPilot.policy.validation.protoInvalid')
  })
})

describe('maskedCidr', () => {
  it('gives the masked form when host bits are set, null otherwise', () => {
    expect(maskedCidr('10.0.0.5/24')).toBe('10.0.0.0/24')
    expect(maskedCidr('192.168.1.130/25')).toBe('192.168.1.128/25')
    expect(maskedCidr('2001:db8::1/64')).toBe('2001:db8::/64')
    expect(maskedCidr('2001:db8:0:1:ffff::1/60')).toBe('2001:db8::/60')
    expect(maskedCidr('10.0.0.0/24')).toBeNull()
    expect(maskedCidr('garbage')).toBeNull()
  })
})
