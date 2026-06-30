import { describe, it, expect } from 'vitest'
import { buildDeployIpconfig0, parseIpconfig0 } from './deployIpconfig'

const sn = (over: Partial<{ cidr: string; gateway: string }> = {}) => ({
  cidr: over.cidr ?? '10.0.1.0/25',
  gateway: over.gateway ?? '10.0.1.253',
  dnsServers: [],
  subnetId: 's1',
})

const base = {
  subnet: null,
  ipOverride: '',
  manualIpCidr: '',
  manualGateway: '',
  useDhcp: false,
}

describe('parseIpconfig0', () => {
  it('returns useDhcp true for "ip=dhcp"', () => {
    expect(parseIpconfig0('ip=dhcp')).toEqual({
      useDhcp: true,
      manualIpCidr: '',
      manualGateway: '',
      host: '',
    })
  })

  it('is case-insensitive for DHCP ("IP=DHCP")', () => {
    expect(parseIpconfig0('IP=DHCP')).toEqual({ useDhcp: true, manualIpCidr: '', manualGateway: '', host: '' })
  })

  it('parses ip/cidr and gateway from a full static string', () => {
    expect(parseIpconfig0('ip=10.0.1.4/24,gw=10.0.1.1')).toEqual({
      useDhcp: false,
      manualIpCidr: '10.0.1.4/24',
      manualGateway: '10.0.1.1',
      host: '10.0.1.4',
    })
  })

  it('parses ip/cidr with no gateway', () => {
    expect(parseIpconfig0('ip=10.0.1.4/24')).toEqual({
      useDhcp: false,
      manualIpCidr: '10.0.1.4/24',
      manualGateway: '',
      host: '10.0.1.4',
    })
  })

  it('parses bare host IP with no prefix (no manualIpCidr)', () => {
    expect(parseIpconfig0('ip=10.0.1.4')).toEqual({
      useDhcp: false,
      manualIpCidr: '',
      manualGateway: '',
      host: '10.0.1.4',
    })
  })

  it('returns all-empty for an empty string', () => {
    expect(parseIpconfig0('')).toEqual({
      useDhcp: false,
      manualIpCidr: '',
      manualGateway: '',
      host: '',
    })
  })

  it('returns all-empty / useDhcp false for a garbage string', () => {
    expect(parseIpconfig0('notavalidipconfig')).toEqual({ useDhcp: false, manualIpCidr: '', manualGateway: '', host: '' })
  })

  it('round-trips DHCP: build → parse → useDhcp true', () => {
    const built = buildDeployIpconfig0({
      subnet: null,
      ipOverride: '',
      manualIpCidr: '',
      manualGateway: '',
      useDhcp: true,
    })
    expect(built).toBe('ip=dhcp')
    expect(parseIpconfig0(built).useDhcp).toBe(true)
  })

  it('round-trips static: build → parse → same fields', () => {
    const built = buildDeployIpconfig0({
      subnet: null,
      ipOverride: '',
      manualIpCidr: '192.168.1.10/24',
      manualGateway: '192.168.1.1',
      useDhcp: false,
    })
    const parsed = parseIpconfig0(built)
    expect(parsed.useDhcp).toBe(false)
    expect(parsed.manualIpCidr).toBe('192.168.1.10/24')
    expect(parsed.manualGateway).toBe('192.168.1.1')
    expect(parsed.host).toBe('192.168.1.10')
  })
})

describe('buildDeployIpconfig0', () => {
  describe('with an IPAM subnet (field holds a bare host IP)', () => {
    it('composes ip/prefix/gw from the subnet', () => {
      expect(buildDeployIpconfig0({ ...base, subnet: sn(), ipOverride: '10.0.1.4' }))
        .toBe('ip=10.0.1.4/25,gw=10.0.1.253')
    })

    it('defaults the prefix to /24 when the subnet CIDR has no suffix', () => {
      expect(buildDeployIpconfig0({
        ...base,
        subnet: sn({ cidr: '192.168.0.0', gateway: '192.168.0.1' }),
        ipOverride: '192.168.0.5',
      })).toBe('ip=192.168.0.5/24,gw=192.168.0.1')
    })

    it('returns empty when no IP is provided (auto-allocate via IPAM)', () => {
      expect(buildDeployIpconfig0({ ...base, subnet: sn() })).toBe('')
    })

    it('ignores the DHCP flag (toggle is only shown without a subnet)', () => {
      expect(buildDeployIpconfig0({ ...base, subnet: sn(), ipOverride: '10.0.1.4', useDhcp: true }))
        .toBe('ip=10.0.1.4/25,gw=10.0.1.253')
    })
  })

  describe('without a subnet (structured manual entry)', () => {
    // #526: static IP + gateway entered as separate fields must reach Proxmox.
    it('composes ip/cidr + gateway from the manual fields (#526)', () => {
      expect(buildDeployIpconfig0({ ...base, manualIpCidr: '10.0.1.4/25', manualGateway: '10.0.1.253' }))
        .toBe('ip=10.0.1.4/25,gw=10.0.1.253')
    })

    it('omits the gateway when none is given (valid: no default route)', () => {
      expect(buildDeployIpconfig0({ ...base, manualIpCidr: '10.0.1.4/25' }))
        .toBe('ip=10.0.1.4/25')
    })

    it('returns ip=dhcp when DHCP is selected', () => {
      expect(buildDeployIpconfig0({ ...base, useDhcp: true })).toBe('ip=dhcp')
    })

    it('lets DHCP win over any typed static values', () => {
      expect(buildDeployIpconfig0({
        ...base,
        useDhcp: true,
        manualIpCidr: '10.0.1.4/25',
        manualGateway: '10.0.1.253',
      })).toBe('ip=dhcp')
    })

    it('trims surrounding whitespace on the manual fields', () => {
      expect(buildDeployIpconfig0({ ...base, manualIpCidr: ' 10.0.1.4/25 ', manualGateway: ' 10.0.1.253 ' }))
        .toBe('ip=10.0.1.4/25,gw=10.0.1.253')
    })

    it('returns empty when nothing is entered', () => {
      expect(buildDeployIpconfig0({ ...base })).toBe('')
    })
  })
})
