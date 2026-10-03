import { describe, expect, it } from 'vitest'

import { buildEndpointIndex, endpointLabel, endpointMatches, mergePairs, normalizeQuery } from './flowSearch'

const pair = (src: string, dst: string, extra = {}) => ({ src_ip: src, dst_ip: dst, bytes: 1, packets: 1, protocol: 'tcp', dst_port: 443, ...extra })

describe('flowSearch', () => {
  it('matches an endpoint on IP, VM name or exact VMID', () => {
    const info = { vmid: 101, name: 'Web-Prod-01' }
    expect(endpointMatches('10.0.0.5', info, '10.0.0')).toBe(true)
    expect(endpointMatches('10.0.0.5', info, normalizeQuery('  WEB-prod '))).toBe(true)
    expect(endpointMatches('10.0.0.5', info, '101')).toBe(true)
    expect(endpointMatches('10.0.0.5', info, '10')).toBe(true)
    expect(endpointMatches('10.0.0.5', info, '102')).toBe(false)
    expect(endpointMatches('8.8.8.8', undefined, '7')).toBe(false)
    expect(endpointMatches('10.0.0.5', info, '')).toBe(false)
  })

  it('learns IP to VM attribution from either end of a pair', () => {
    const index = buildEndpointIndex([
      pair('10.0.0.1', '10.0.0.2', { dst_vmid: 102 }),
      pair('10.0.0.2', '10.0.0.3', { src_vmid: 102, src_name: 'db' }),
    ])
    expect(index.get('10.0.0.2')).toEqual({ vmid: 102, name: 'db' })
    expect(index.has('10.0.0.1')).toBe(false)
    expect(endpointLabel('10.0.0.2', index.get('10.0.0.2'))).toBe('db (10.0.0.2)')
    expect(endpointLabel('10.0.0.7', { vmid: 107 })).toBe('VM 107 (10.0.0.7)')
    expect(endpointLabel('10.0.0.1', undefined)).toBe('10.0.0.1')
  })

  it('merges server matches into the top pairs without duplicates', () => {
    const merged = mergePairs([pair('a', 'b'), pair('c', 'd')], [pair('c', 'd'), pair('e', 'f')])
    expect(merged.map(p => `${p.src_ip}>${p.dst_ip}`)).toEqual(['a>b', 'c>d', 'e>f'])
  })
})
