import { describe, expect, it } from 'vitest'

import { flowZoneHint } from './flowZoneHint'
import { filterGuest } from './ipFilterTestKit'
import { db, web } from './policyTestKit'
import { singleHost } from './zoneForm'

describe('singleHost', () => {
  it('reads a plain address or a single-host CIDR, in canonical form', () => {
    expect(singleHost('10.22.22.3')).toBe('10.22.22.3')
    expect(singleHost(' 10.22.22.3/32 ')).toBe('10.22.22.3')
    expect(singleHost('fd00:0:0::5/128')).toBe('fd00::5')
    expect(singleHost('FD00::5')).toBe('fd00::5')
    expect(singleHost('::')).toBe('::')
  })

  it('refuses a network or anything else', () => {
    for (const v of ['10.22.22.0/24', 'fd00::/64', '10.22.22.3/33', 'nope', '', '10.0.0.01']) expect(singleHost(v), v).toBeNull()
  })
})

describe('flowZoneHint', () => {
  const zones = [web(), db()]
  const member = filterGuest({ name: 'db-1', zone: 'db', nics: { net0: ['0.0.0.0', '10.22.22.3', 'fd00::3', 'fe80::be24:11ff:fe00:64'] } })

  it('names the zone, the member and the address', () => {
    expect(flowZoneHint('10.22.22.3/32', [member], zones)).toEqual({ zoneId: 'zd', zone: 'db', guest: 'db-1', addr: '10.22.22.3' })
    expect(flowZoneHint('fd00:0::3/128', [member], zones)?.zoneId).toBe('zd')
  })

  it('gives nothing for a network, an unknown address or a technical one', () => {
    for (const cidr of ['10.22.22.0/24', '10.22.22.4/32', '0.0.0.0/32', 'fe80::be24:11ff:fe00:64/128']) {
      expect(flowZoneHint(cidr, [member], zones), cidr).toBeNull()
    }
  })

  it('gives nothing when members of two zones report the address', () => {
    const other = filterGuest({ vmid: 101, name: 'web-1', zone: 'web', nics: { net0: ['10.22.22.3'] } })
    expect(flowZoneHint('10.22.22.3/32', [member, other], zones)).toBeNull()
  })

  it('leaves out an address added by hand, a guest of no zone and a zone the draft no longer has', () => {
    expect(flowZoneHint('10.22.22.3/32', [{ ...member, extra: ['10.22.22.3/32'] }], zones)).toBeNull()
    expect(flowZoneHint('10.22.22.3/32', [{ ...member, zone: '' }], zones)).toBeNull()
    expect(flowZoneHint('10.22.22.3/32', [{ ...member, zone: 'gone' }], zones)).toBeNull()
  })

  it('names a member without a name by its VMID', () => {
    expect(flowZoneHint('10.22.22.3/32', [{ ...member, name: '' }], zones)?.guest).toBe('100')
  })
})
