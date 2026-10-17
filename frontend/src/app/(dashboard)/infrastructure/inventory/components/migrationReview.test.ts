import { describe, it, expect } from 'vitest'

import {
  sourceHardware, initialHardwareState, initialNicState, hardwareErrors, vlanTagInvalid, reviewIsValid,
  buildHardwarePayload, buildNicsPayload, mergeCpuModels, type ReviewSource,
} from './migrationReview'

const source: ReviewSource = {
  numCPU: 4, numCoresPerSocket: 2, sockets: 2, memoryMB: 4096,
  nics: [
    { label: 'Network adapter 1', type: 'Vmxnet3', macAddress: '00:50:56:aa:00:01', network: 'VM Network' },
    { label: 'Network adapter 2', type: 'E1000', macAddress: '00:50:56:aa:00:02', network: 'dmz' },
  ],
}

describe('sourceHardware / initial state', () => {
  it('derives cores per socket like the mapper, and falls back to the total vCPU count', () => {
    expect(sourceHardware(source)).toEqual({ cores: 2, sockets: 2, memoryMB: 4096 })
    expect(sourceHardware({ ...source, numCoresPerSocket: 0 })).toEqual({ cores: 4, sockets: 2, memoryMB: 4096 })
    expect(sourceHardware(null)).toEqual({ cores: 0, sockets: 0, memoryMB: 0 })
  })

  it('starts the fields on the source values and one NIC row per source adapter', () => {
    expect(initialHardwareState(source)).toEqual({ cores: '2', sockets: '2', memoryMB: '4096' })
    expect(initialHardwareState(null)).toEqual({ cores: '', sockets: '', memoryMB: '' })
    expect(initialNicState(source, 'vmbr0', '')).toEqual([
      { bridge: 'vmbr0', vlanTag: '', model: '' }, { bridge: 'vmbr0', vlanTag: '', model: '' },
    ])
    expect(initialNicState(null, 'vmbr0', '')).toEqual([])
  })
})

describe('validation', () => {
  it('flags values outside the Proxmox limits, never a blank field', () => {
    expect(hardwareErrors({ cores: '', sockets: '', memoryMB: '' })).toEqual({ cores: false, sockets: false, memoryMB: false })
    expect(hardwareErrors({ cores: '0', sockets: '5', memoryMB: '8' })).toEqual({ cores: true, sockets: true, memoryMB: true })
    expect(hardwareErrors({ cores: '128', sockets: '4', memoryMB: '16' })).toEqual({ cores: false, sockets: false, memoryMB: false })
  })

  it('validates a VLAN tag like the step-1 field', () => {
    expect(vlanTagInvalid('')).toBe(false)
    expect(vlanTagInvalid('42')).toBe(false)
    expect(vlanTagInvalid('0')).toBe(true)
    expect(vlanTagInvalid('4095')).toBe(true)
  })

  it('blocks the launch on a bad field or a NIC without a bridge', () => {
    const hw = { cores: '2', sockets: '1', memoryMB: '2048' }
    expect(reviewIsValid(hw, [{ bridge: 'vmbr0', vlanTag: '', model: '' }])).toBe(true)
    expect(reviewIsValid(hw, [{ bridge: '', vlanTag: '', model: '' }])).toBe(false)
    expect(reviewIsValid(hw, [{ bridge: 'vmbr0', vlanTag: '9999', model: '' }])).toBe(false)
    expect(reviewIsValid({ ...hw, cores: '200' }, [])).toBe(false)
  })
})

describe('payload', () => {
  it('sends only the hardware values that differ from the source', () => {
    expect(buildHardwarePayload({ cores: '2', sockets: '2', memoryMB: '4096' }, source)).toBeUndefined()
    expect(buildHardwarePayload({ cores: '4', sockets: '', memoryMB: '8192' }, source)).toEqual({ cores: 4, memoryMB: 8192 })
    expect(buildHardwarePayload({ cores: 'x', sockets: '1', memoryMB: '' }, source)).toEqual({ sockets: 1 })
  })

  it('maps every NIC by position, with the tag only when the operator may set one', () => {
    const nics = [{ bridge: 'vmbr0', vlanTag: '42', model: '' }, { bridge: 'vf95117a', vlanTag: '', model: 'e1000' }]
    expect(buildNicsPayload(nics, true)).toEqual([{ index: 0, bridge: 'vmbr0', vlanTag: 42 }, { index: 1, bridge: 'vf95117a', model: 'e1000' }])
    expect(buildNicsPayload(nics, false)).toEqual([{ index: 0, bridge: 'vmbr0' }, { index: 1, bridge: 'vf95117a', model: 'e1000' }])
    expect(buildNicsPayload([], true)).toBeUndefined()
  })

  it('merges the quick CPU list with the node models, custom ones prefixed', () => {
    const quick = ['x86-64-v2-AES', 'host']
    expect(mergeCpuModels(quick, [{ name: 'host' }, { name: 'kvm64' }, { name: 'gold', custom: 1 }, { name: 'EPYC' }, { name: '' }]))
      .toEqual(['x86-64-v2-AES', 'host', 'custom-gold', 'EPYC', 'kvm64'])
    expect(mergeCpuModels(quick, undefined)).toEqual(quick)
  })
})
