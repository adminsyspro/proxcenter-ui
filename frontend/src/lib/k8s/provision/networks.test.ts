import { describe, it, expect } from 'vitest'
import { defaultRanges, effectiveRanges, parseCidr, rangeErrors, rangesConfigurable } from './networks'

const input = (over: Partial<Parameters<typeof rangeErrors>[0]> = {}) => ({
  distro: 'k3s', podCIDR: '', serviceCIDR: '', subnetPrefix: 24, nodeIps: ['192.168.1.10'], ...over,
})

describe('defaults', () => {
  it('gives k3s and RKE2 the Rancher ranges, kubeadm and Talos the upstream ones', () => {
    expect(defaultRanges('k3s')).toEqual({ pod: '10.42.0.0/16', service: '10.43.0.0/16' })
    expect(defaultRanges('rke2')).toEqual(defaultRanges('k3s'))
    expect(defaultRanges('kubeadm')).toEqual({ pod: '10.244.0.0/16', service: '10.96.0.0/12' })
    expect(defaultRanges('talos')).toEqual(defaultRanges('kubeadm'))
  })
  it('lets every distribution but Talos change them', () => {
    expect(['k3s', 'rke2', 'kubeadm', 'talos'].map(rangesConfigurable)).toEqual([true, true, true, false])
  })
  it('uses what was typed, and ignores it for Talos', () => {
    expect(effectiveRanges({ distro: 'k3s', podCIDR: ' 10.50.0.0/16 ', serviceCIDR: '' })).toEqual({ pod: '10.50.0.0/16', service: '10.43.0.0/16' })
    expect(effectiveRanges({ distro: 'talos', podCIDR: '10.50.0.0/16', serviceCIDR: '10.60.0.0/16' })).toEqual(defaultRanges('talos'))
  })
})

describe('parseCidr', () => {
  it('parses a range and aligns it on its prefix', () => {
    expect(parseCidr('10.42.0.85/24')).toEqual({ base: 10 * 2 ** 24 + 42 * 2 ** 16, size: 256 })
    expect(parseCidr('0.0.0.0/0')).toEqual({ base: 0, size: 2 ** 32 })
  })
  it('refuses what is not an IPv4 range', () => {
    for (const bad of ['10.42.0.0', '10.42.0/16', '10.42.0.300/16', '10.42.0.0/33', 'abc', '']) {
      expect(parseCidr(bad)).toBeNull()
    }
  })
})

describe('rangeErrors', () => {
  it('accepts the defaults on an unrelated node network', () => {
    expect(rangeErrors(input())).toEqual([])
  })
  it('refuses the k3s default pod range when the nodes live inside it', () => {
    expect(rangeErrors(input({ nodeIps: ['10.42.0.87', '10.42.0.88'] }))).toEqual([
      { code: 'cidrOverlapNodes', field: 'pod', cidr: '10.42.0.0/16', nodes: '10.42.0.0/24' },
    ])
  })
  it('accepts other ranges on that same node network', () => {
    expect(rangeErrors(input({ nodeIps: ['10.42.0.87'], podCIDR: '10.244.0.0/16', serviceCIDR: '10.96.0.0/16' }))).toEqual([])
  })
  it('refuses a service range on the node network', () => {
    expect(rangeErrors(input({ nodeIps: ['10.43.7.9'] }))).toEqual([
      { code: 'cidrOverlapNodes', field: 'service', cidr: '10.43.0.0/16', nodes: '10.43.7.0/24' },
    ])
  })
  it('refuses pod and service ranges that overlap', () => {
    expect(rangeErrors(input({ podCIDR: '10.50.0.0/16', serviceCIDR: '10.50.4.0/24' }))).toEqual([{ code: 'cidrOverlapEach', field: 'service' }])
  })
  it('reports a range that is not valid', () => {
    expect(rangeErrors(input({ podCIDR: '10.50.0.0' }))).toEqual([{ code: 'cidrInvalid', field: 'pod', cidr: '10.50.0.0' }])
  })
  it('checks the Talos defaults against the node network even though they cannot be changed', () => {
    expect(rangeErrors(input({ distro: 'talos', nodeIps: ['10.244.3.4'], podCIDR: '10.50.0.0/16' }))).toEqual([
      { code: 'cidrOverlapNodes', field: 'pod', cidr: '10.244.0.0/16', nodes: '10.244.3.0/24' },
    ])
  })
  it('ignores node addresses not typed yet', () => {
    expect(rangeErrors(input({ nodeIps: ['', '10.'] }))).toEqual([])
  })
})
