import { describe, expect, it } from 'vitest'

import { gatewayNameMap, gatewayZones, namedAddress } from './gatewayNames'
import { gatewayCidr, gatewayServiceFlows, gatewayServicePorts, GATEWAY_SERVICES, typedServiceCandidates, typedServiceText, validateZoneForm, ZONE_COLORS } from './zoneForm'

const zones = [{ name: 'web', gateway: '10.30.0.1' }, { name: 'db', gateway: '10.30.0.1' }, { name: 'v6', gateway: '2001:db8::1' }, { name: 'none', gateway: '' }, { name: 'old' }]

describe('gateway names', () => {
  it('names the zones of a gateway, sorted, with or without a host prefix', () => {
    expect(gatewayZones(zones, '10.30.0.1')).toEqual(['db', 'web'])
    expect(gatewayZones(zones, '10.30.0.1/32')).toEqual(['db', 'web'])
    expect(gatewayZones(zones, '2001:db8::1/128')).toEqual(['v6'])
    expect(gatewayZones(zones, '10.30.0.2')).toEqual([])
    expect(gatewayZones(zones, '')).toEqual([])
  })

  it('maps every gateway to its name and writes it before the address', () => {
    const map = gatewayNameMap(zones, names => `Gateway of ${names}`)
    expect([...map]).toEqual([['10.30.0.1', 'Gateway of db, web'], ['2001:db8::1', 'Gateway of v6']])
    expect(namedAddress('10.30.0.1', map)).toBe('Gateway of db, web (10.30.0.1)')
    expect(namedAddress('10.30.0.9', map)).toBe('10.30.0.9')
  })
})

describe('gateway flows', () => {
  it('opens DNS over UDP and TCP, NTP over UDP, and pings with the ICMP of the address family', () => {
    expect(gatewayServiceFlows('dns', '10.30.0.1')).toEqual([{ proto: 'udp', dport: '53' }, { proto: 'tcp', dport: '53' }])
    expect(gatewayServiceFlows('ntp', '10.30.0.1')).toEqual([{ proto: 'udp', dport: '123' }])
    expect(gatewayServiceFlows('ping', '10.30.0.1')).toEqual([{ proto: 'icmp', dport: '' }])
    expect(gatewayServiceFlows('ping', '2001:db8::1')).toEqual([{ proto: 'icmpv6', dport: '' }])
    expect(GATEWAY_SERVICES.map(s => gatewayServicePorts(s, '10.30.0.1'))).toEqual(['udp/53, tcp/53', 'udp/123', 'icmp', 'tcp/80', 'tcp/443', 'tcp/22', 'udp/161', 'udp/514', 'tcp/3128'])
    expect(gatewayCidr('10.30.0.1')).toBe('10.30.0.1/32')
    expect(gatewayCidr('2001:db8::1')).toBe('2001:db8::1/128')
  })

  it('takes a typed service as the flow dialog takes it, in one spelling', () => {
    expect(['tcp/8443', ' TCP / 8443 ', 'udp/53,123', 'tcp/5000:5010', 'icmp', 'icmpv6', 'any'].map(typedServiceText)).toEqual(['tcp/8443', 'tcp/8443', 'udp/53,123', 'tcp/5000:5010', 'icmp', 'icmpv6', 'any'])
    for (const bad of ['tcp', 'tcp/', 'tcp/0', 'tcp/70000', 'tcp/10:5', 'icmp/8', 'gre/1', 'tcp/22/23', 'ssh']) expect(typedServiceText(bad), bad).toBeNull()
    expect(gatewayServiceFlows('udp/5000:5010', '10.30.0.1')).toEqual([{ proto: 'udp', dport: '5000:5010' }])
    expect(gatewayServiceFlows('nonsense', '10.30.0.1')).toEqual([])
    expect(typedServiceText('tcp 8443')).toBe('tcp/8443')
    expect(typedServiceCandidates('udp 514')).toEqual(['udp/514'])
    expect(typedServiceCandidates('8443')).toEqual(['tcp/8443', 'udp/8443'])
    expect(typedServiceCandidates('5000:5010')).toEqual(['tcp/5000:5010', 'udp/5000:5010'])
    expect(typedServiceCandidates('dn')).toEqual([])
  })

  it('takes an empty gateway or a plain address, refuses a prefix or a name', () => {
    const form = (gateway: string) => validateZoneForm({ name: 'web', label: '', color: ZONE_COLORS[0], isolate_members: false, state: 'disabled', egress_state: 'off', egress_mode: 'local', gateway, gateway_services: [] })
    expect(form('').gateway).toBeUndefined()
    expect(form('10.30.0.1').gateway).toBeUndefined()
    expect(form('2001:db8::1').gateway).toBeUndefined()
    expect(form('10.30.0.1/24').gateway).toBe('microsegPilot.policy.validation.gatewayInvalid')
    expect(form('router').gateway).toBe('microsegPilot.policy.validation.gatewayInvalid')
  })
})

describe('a gateway as the end of an observed flow', () => {
  it('is named, a zone keeps its name, an unknown address stays bare', async () => {
    const { endpoint } = await import('./ObservationRow')
    const t = (key: string) => key
    const name = (ip: string) => (ip === '10.30.0.1' ? 'Gateway of web (10.30.0.1)' : undefined)
    expect(endpoint('', '10.30.0.1', new Map(), t, name)).toBe('Gateway of web (10.30.0.1)')
    expect(endpoint('', '10.30.0.9', new Map(), t, name)).toBe('10.30.0.9')
    expect(endpoint('', '', new Map(), t, name)).toBe('unknownEndpoint')
  })
})
