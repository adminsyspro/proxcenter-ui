import { describe, expect, it } from 'vitest'

import { WELL_KNOWN_PORTS, WELL_KNOWN_RANGES } from './wellKnownPorts'
import { serviceLabel, serviceName, serviceTitle, serviceTokenLabel, serviceTokenTitle, serviceTokensTitle } from './serviceNames'

describe('serviceLabel', () => {
  it('names the everyday ports with the casing admins use', () => {
    expect(serviceLabel('tcp', 22)).toBe('SSH')
    expect(serviceLabel('tcp', '443')).toBe('HTTPS')
    expect(serviceLabel('tcp', '5432')).toBe('PostgreSQL')
    expect(serviceLabel('udp', 53)).toBe('DNS')
    expect(serviceLabel('tcp', 8080)).toBe('HTTP-alt')
    expect(serviceLabel('tcp', 8006)).toBe('Proxmox VE')
    expect(serviceLabel('tcp', 9100)).toBe('node-exporter')
    expect(serviceLabel('tcp', 8000)).toBe('HTTP-alt')
    expect(serviceLabel('tcp', 11211)).toBe('Memcached')
    expect(serviceLabel('tcp', 15672)).toBe('RabbitMQ management')
  })

  it('names the ports below 1024 from the IANA registry, with the display casing of the common ones', () => {
    expect(WELL_KNOWN_PORTS['tcp/25']).toBe('SMTP')
    expect(WELL_KNOWN_PORTS['tcp/993']).toBe('IMAPS')
    expect(WELL_KNOWN_PORTS['tcp/389']).toBe('LDAP')
    expect(WELL_KNOWN_PORTS['udp/123']).toBe('NTP')
    expect(WELL_KNOWN_PORTS['tcp/445']).toBe('SMB')
    expect(WELL_KNOWN_PORTS['udp/67']).toBe('DHCP')
    expect(serviceName('tcp', 1)).toBe('tcpmux')
    expect(serviceName('tcp', 79)).toBe('finger')
    expect(serviceName('udp', 69)).toBe('TFTP')
  })

  it('names the curated services above 1024 and the modern ones', () => {
    expect(serviceLabel('tcp', 6443)).toBe('Kubernetes API')
    expect(serviceLabel('tcp', 8007)).toBe('Proxmox Backup')
    expect(serviceLabel('udp', 4789)).toBe('VXLAN')
    expect(serviceLabel('tcp', 3389)).toBe('RDP')
    expect(serviceLabel('tcp', 9092)).toBe('Kafka')
  })

  it('names a port of a range and leaves a port outside it', () => {
    expect(serviceLabel('tcp', 5930)).toBe('VNC')
    expect(serviceLabel('tcp', 7000)).toBe('Ceph OSD')
    expect(serviceLabel('tcp', 7301)).toBe('tcp/7301')
    expect(serviceLabel('tcp', 8301)).toBe('Consul')
    expect(serviceLabel('tcp', 27018)).toBe('MongoDB')
  })

  it('leaves the obscure registered ports above 1024 and the dynamic ports raw', () => {
    expect(serviceLabel('tcp', 2000)).toBe('tcp/2000')
    expect(serviceLabel('tcp', 5555)).toBe('tcp/5555')
    expect(serviceLabel('tcp', 42001)).toBe('tcp/42001')
    expect(serviceLabel('udp', 51820)).toBe('udp/51820')
    expect(serviceLabel('tcp', 60000)).toBe('tcp/60000')
  })

  it('does not name a port of the wrong protocol, a range or a list', () => {
    expect(serviceLabel('udp', 6443)).toBe('udp/6443')
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
})

describe('serviceTitle and the tokens of the flows', () => {
  it('puts the protocol and the port in the title of a known service only', () => {
    expect(serviceTitle('tcp', 22)).toBe('SSH (tcp/22)')
    expect(serviceTitle('udp', '53')).toBe('DNS (udp/53)')
    expect(serviceTitle('tcp', 42001)).toBe('tcp/42001')
    expect(serviceTitle('tcp', '8000-8100')).toBe('tcp/8000-8100')
  })

  it('maps the tokens "proto/ports"', () => {
    expect(serviceTokenLabel('tcp/22')).toBe('SSH')
    expect(serviceTokenLabel('tcp/22,42001')).toBe('SSH, tcp/42001')
    expect(serviceTokenLabel('icmp')).toBe('icmp')
    expect(serviceTokenTitle('udp/53')).toBe('DNS (udp/53)')
    expect(serviceTokensTitle(['tcp/22', 'tcp/8080', 'icmp'])).toBe('SSH (tcp/22), HTTP-alt (tcp/8080), icmp')
  })
})

describe('the generated table', () => {
  it('stays small, has no name from the dynamic range and keeps a range as a range', () => {
    const ports = Object.keys(WELL_KNOWN_PORTS).map(k => Number(k.split('/')[1]))
    expect(ports.length).toBeGreaterThan(1000)
    expect(Math.max(...ports)).toBeLessThan(49152)
    expect(WELL_KNOWN_RANGES.some(r => r[0] === 'tcp' && r[1] === 5900 && r[2] === 5999 && r[3] === 'VNC')).toBe(true)
    expect(ports.filter(p => p >= 1024).length).toBeLessThan(250)
  })
})
