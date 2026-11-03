import { beforeEach, describe, expect, it } from 'vitest'

import { WELL_KNOWN_PORTS, WELL_KNOWN_RANGES } from './wellKnownPorts'
import {
  COMMON_TABLE, loadServiceNames, resetServiceNames, serviceLabel, serviceName, serviceTitle, serviceTokenLabel, serviceTokenTitle, serviceTokensTitle,
} from './serviceNames'

beforeEach(() => resetServiceNames())

describe('the common table (before the full one is loaded)', () => {
  it('names the everyday ports synchronously, with the casing admins use', () => {
    expect(serviceLabel('tcp', 22)).toBe('SSH')
    expect(serviceLabel('tcp', '443')).toBe('HTTPS')
    expect(serviceLabel('tcp', '5432')).toBe('PostgreSQL')
    expect(serviceLabel('udp', 53)).toBe('DNS')
    expect(serviceLabel('tcp', 8080)).toBe('HTTP-alt')
    expect(serviceLabel('tcp', 8006)).toBe('Proxmox VE')
    expect(serviceLabel('tcp', 9100)).toBe('node-exporter')
  })

  it('names a port of a range and leaves a port outside it', () => {
    expect(serviceLabel('tcp', 5930)).toBe('VNC')
    expect(serviceLabel('tcp', 7000)).toBe('Ceph OSD')
    expect(serviceLabel('tcp', 7301)).toBe('tcp/7301')
  })

  it('does not name a port of the wrong protocol, an unknown port, a range or a list', () => {
    expect(serviceLabel('udp', 22)).toBe('udp/22')
    expect(serviceLabel('tcp', 42001)).toBe('tcp/42001')
    expect(serviceLabel('tcp', '8000-8100')).toBe('tcp/8000-8100')
    expect(serviceLabel('tcp', '80,443')).toBe('tcp/80,443')
    expect(serviceName('tcp', '0')).toBeNull()
    expect(serviceName('tcp', '70000')).toBeNull()
    expect(serviceName('icmp', '22')).toBeNull()
    expect(serviceName('tcp', undefined)).toBeNull()
  })

  it('reads a protocol without port as its name', () => {
    expect(serviceLabel('icmp')).toBe('icmp')
    expect(serviceLabel('tcp', '')).toBe('tcp')
    expect(serviceTitle('icmp')).toBe('icmp')
  })

  it('puts the protocol and the port in the title of a known service only', () => {
    expect(serviceTitle('tcp', 22)).toBe('SSH (tcp/22)')
    expect(serviceTitle('udp', '53')).toBe('DNS (udp/53)')
    expect(serviceTitle('tcp', 42001)).toBe('tcp/42001')
    expect(serviceTitle('tcp', '8000-8100')).toBe('tcp/8000-8100')
  })

  it('maps the tokens "proto/ports" of the flows', () => {
    expect(serviceTokenLabel('tcp/22')).toBe('SSH')
    expect(serviceTokenLabel('tcp/22,42001')).toBe('SSH, tcp/42001')
    expect(serviceTokenLabel('icmp')).toBe('icmp')
    expect(serviceTokenTitle('udp/53')).toBe('DNS (udp/53)')
    expect(serviceTokensTitle(['tcp/22', 'tcp/8080', 'icmp'])).toBe('SSH (tcp/22), HTTP-alt (tcp/8080), icmp')
  })
})

describe('the full table (lazy)', () => {
  it('answers from the common table until it is loaded, then from the IANA registry', async () => {
    expect(serviceName('tcp', 1010)).toBeNull()
    expect(serviceLabel('tcp', 22)).toBe('SSH')
    await loadServiceNames()
    expect(serviceName('tcp', 1010)).toBe('surf')
    expect(serviceLabel('udp', 161)).toBe('SNMP')
    expect(serviceLabel('tcp', 22)).toBe('SSH')
  })

  it('loads once', async () => {
    const first = loadServiceNames()
    expect(loadServiceNames()).toBe(first)
    await first
  })

  it('keeps entries of /etc/services-like names in their display casing and the modern services of the overlay', () => {
    expect(WELL_KNOWN_PORTS['tcp/25']).toBe('SMTP')
    expect(WELL_KNOWN_PORTS['tcp/993']).toBe('IMAPS')
    expect(WELL_KNOWN_PORTS['tcp/389']).toBe('LDAP')
    expect(WELL_KNOWN_PORTS['udp/123']).toBe('NTP')
    expect(WELL_KNOWN_PORTS['tcp/3389']).toBe('RDP')
    expect(WELL_KNOWN_PORTS['tcp/445']).toBe('SMB')
    expect(WELL_KNOWN_PORTS['udp/67']).toBe('DHCP')
    expect(WELL_KNOWN_PORTS['tcp/8007']).toBe('Proxmox Backup')
    expect(WELL_KNOWN_PORTS['tcp/6443']).toBe('Kubernetes API')
    expect(WELL_KNOWN_PORTS['udp/51820']).toBe('WireGuard')
    expect(WELL_KNOWN_PORTS['udp/4789']).toBe('VXLAN')
    expect(Object.keys(WELL_KNOWN_PORTS).length).toBeGreaterThan(5000)
  })

  it('agrees with the common table on every entry', () => {
    for (const [key, name] of Object.entries(COMMON_TABLE.points)) expect(WELL_KNOWN_PORTS[key], key).toBe(name)
    for (const range of COMMON_TABLE.ranges) expect(WELL_KNOWN_RANGES.some(r => r.join() === range.join()), range.join()).toBe(true)
  })
})
