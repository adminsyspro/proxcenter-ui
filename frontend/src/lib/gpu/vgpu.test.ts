import { describe, expect, it } from 'vitest'

import { isComputeProfile, mdevTypeId, parseProfile, profileCapacity, profileMemory, profileName } from './vgpu'

const catalog = [
  { deviceKey: 'c1:n1:0000:03:00', typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 },
  { deviceKey: 'c1:n1:0000:03:00', typeId: 657, name: 'RTXA5000-1B', fbMemory: 1024, maxInstances: 24 },
]

describe('vGPU profiles', () => {
  it('reads the size and series of a profile name', () => {
    expect(parseProfile('RTXA5000-12Q')).toEqual({ gib: 12, series: 'Q' })
    expect(parseProfile('L40S-48C')).toEqual({ gib: 48, series: 'C' })
    expect(parseProfile('weird')).toBeNull()
    expect(isComputeProfile('RTXA5000-12Q')).toBe(true)
    expect(isComputeProfile('RTXA5000-1B')).toBe(false)
  })

  it('names an mdev type from the catalog of its card', () => {
    expect(mdevTypeId('nvidia-665')).toBe(665)
    expect(mdevTypeId('i915-GVTg_V5_4')).toBeNull()
    expect(profileName('nvidia-665', 'c1:n1:0000:03:00', catalog)).toBe('RTXA5000-12Q')
    expect(profileName('nvidia-665', 'c1:n1:0000:41:00', catalog)).toBeNull()
    expect(profileMemory('nvidia-665', 'c1:n1:0000:03:00', catalog)).toBe(12288)
    expect(profileMemory('nvidia-999', null, catalog)).toBeNull()
  })
})

describe('profileCapacity', () => {
  const card = (key: string, node: string) => ({ key, node, connectionName: 'LAB', vendorId: '0x10de', vendorName: 'NVIDIA', deviceName: 'GA102GL [RTX A5000]', deviceId: '0x2231' })
  const types = (deviceKey: string) => [
    { deviceKey, typeId: 664, name: 'RTXA5000-8Q', fbMemory: 8192, maxInstances: 3 },
    { deviceKey, typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 },
    { deviceKey, typeId: 666, name: 'RTXA5000-24Q', fbMemory: 24576, maxInstances: 1 },
    { deviceKey, typeId: 657, name: 'RTXA5000-1B', fbMemory: 1024, maxInstances: 24 },
  ]
  const alloc = (vmid: string, deviceKey: string, mdev: string | null, over: Record<string, unknown> = {}) => ({ deviceKey, mdev, vmid, vmName: `vm-${vmid}`, vmStatus: 'running', template: false, hidden: false, ...over })

  it('counts the holders of each profile and what each card can still take, stopped VMs promised too', () => {
    const [model] = profileCapacity(
      [card('a', 'n1'), card('b', 'n2')],
      [alloc('9010', 'a', 'nvidia-665'), alloc('9011', 'a', 'nvidia-664', { vmStatus: 'stopped' }), alloc('9020', 'a', null), alloc('9030', 'a', 'nvidia-665', { template: true })],
      [...types('a'), ...types('b')],
    )
    expect(model.cards.map(c => [c.deviceKey, c.fbTotal, c.fbPromised])).toEqual([['a', 24576, 20480], ['b', 24576, 0]])
    const row = (n: string) => model.rows.find(r => r.name === n)!
    expect(row('RTXA5000-12Q').holders.map(h => [h.vmid, h.running])).toEqual([['9010', true]])
    expect(row('RTXA5000-8Q').holders.map(h => [h.vmid, h.running])).toEqual([['9011', false]])
    // Card a has 4 GiB left: no 8Q nor 12Q; card b is empty: 3 x 8Q (capped), 2 x 12Q, 1 x 24Q.
    expect(row('RTXA5000-8Q').perCard).toEqual([{ deviceKey: 'a', node: 'n1', free: 0 }, { deviceKey: 'b', node: 'n2', free: 3 }])
    expect(row('RTXA5000-12Q').perCard.map(p => p.free)).toEqual([0, 2])
    expect(row('RTXA5000-24Q').perCard.map(p => p.free)).toEqual([0, 1])
    expect(row('RTXA5000-1B').perCard.map(p => p.free)).toEqual([4, 24])
    // B profiles first, then Q, each by size.
    expect(model.rows.map(r => r.name)).toEqual(['RTXA5000-1B', 'RTXA5000-8Q', 'RTXA5000-12Q', 'RTXA5000-24Q'])
  })

  it('names a card whose host was not read', () => {
    const [model] = profileCapacity([card('a', 'n1')], [], [])
    expect(model.unread).toEqual(['a'])
    expect(model.rows).toEqual([])
  })
})
