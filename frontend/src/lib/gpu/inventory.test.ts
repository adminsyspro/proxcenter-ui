import { describe, expect, it } from 'vitest'

import {
  addressMatchesDevice,
  classifyDisplayEntry,
  collectNodeDevices,
  computeCapacity,
  displaySubclass,
  parseHostpciEntries,
  parsePciAddress,
  parsePciMappings,
  resolveAllocations,
  type GuestForAllocation,
  type PvePciEntry,
} from './inventory'

// A "real" GPU host as /nodes/gpu1/hardware/pci returns it: two NVIDIA GPUs,
// one with its HDMI audio function, the ASPEED VGA of the BMC, a NIC.
const GPU_HOST: PvePciEntry[] = [
  { id: '0000:01:00.0', class: '0x030000', vendor: '0x10de', device: '0x2204', vendor_name: 'NVIDIA Corporation', device_name: 'GA102 [GeForce RTX 3090]', iommugroup: 14, subsystem_vendor_name: 'ASUSTeK Computer Inc.', subsystem_device_name: 'Device 87b3' },
  { id: '0000:01:00.1', class: '0x040300', vendor: '0x10de', device: '0x1aef', vendor_name: 'NVIDIA Corporation', device_name: 'GA102 High Definition Audio Controller', iommugroup: 14 },
  { id: '0000:41:00.0', class: '0x030200', vendor: '0x10de', device: '0x20b5', vendor_name: 'NVIDIA Corporation', device_name: 'GA100 [A100 PCIe 80GB]', iommugroup: 40, mdev: 1 },
  { id: '0000:03:00.0', class: '0x030000', vendor: '0x1a03', device: '0x2000', vendor_name: 'ASPEED Technology, Inc.', device_name: 'ASPEED Graphics Family', iommugroup: 7 },
  { id: '0000:04:00.0', class: '0x020000', vendor: '0x8086', device: '0x1521', vendor_name: 'Intel Corporation', device_name: 'I350 Gigabit', iommugroup: 7 },
]

const MAPPINGS_RAW = [
  { id: 'a100', type: 'pci', map: ['node=gpu1,path=0000:41:00.0,id=10de:20b5,iommugroup=40', 'node=gpu2,path=0000:41:00.0,id=10de:20b5'] },
]

const guest = (vmid: string, status: string, config: Record<string, unknown>, extra: Partial<GuestForAllocation> = {}): GuestForAllocation => ({
  vmid, node: 'gpu1', name: `vm-${vmid}`, status, template: false, pool: null, tags: [], config, ...extra,
})

describe('PCI address and class parsing', () => {
  it('normalises the domain and keeps the function optional', () => {
    expect(parsePciAddress('01:00')).toEqual({ slot: '0000:01:00', fn: null })
    expect(parsePciAddress('01:00.0')).toEqual({ slot: '0000:01:00', fn: '0' })
    expect(parsePciAddress('0000:41:00')).toEqual({ slot: '0000:41:00', fn: null })
    expect(parsePciAddress('0001:0A:1F.3')).toEqual({ slot: '0001:0a:1f', fn: '3' })
    expect(parsePciAddress('nonsense')).toBeNull()
    expect(parsePciAddress(42)).toBeNull()
  })

  it('counts VGA, 3D and other display controllers only', () => {
    expect(displaySubclass('0x030000')).toBe('0300')
    expect(displaySubclass('0x030200')).toBe('0302')
    expect(displaySubclass('0x038000')).toBe('0380')
    expect(displaySubclass('0x040300')).toBeNull()
    expect(displaySubclass('0x030100')).toBeNull()
    expect(displaySubclass(undefined)).toBeNull()
  })
})

describe('classifyDisplayEntry', () => {
  it('sets BMC and emulated adapters apart from the GPUs', () => {
    expect(classifyDisplayEntry(GPU_HOST[3])).toEqual({ kind: 'console', reason: 'vendor' })
    expect(classifyDisplayEntry({ id: '0000:00:02.0', class: '0x030000', vendor: '0x102b', device: '0x0536' })).toEqual({ kind: 'console', reason: 'vendor' })
    expect(classifyDisplayEntry({ id: '0000:02:00.0', class: '0x030000', vendor: '0x19e5', device: '0x1711', vendor_name: 'Huawei' })).toEqual({ kind: 'console', reason: 'vendor' })
    expect(classifyDisplayEntry(GPU_HOST[0])).toEqual({ kind: 'gpu', reason: null })
  })

  it('treats the nested-lab QEMU VGA (0x1234:0x1111, no vendor name, no IOMMU) as a console', () => {
    const lab: PvePciEntry = { id: '0000:00:02.0', class: '0x030000', vendor: '0x1234', device: '0x1111', iommugroup: -1, subsystem_vendor_name: 'Red Hat, Inc.' }
    expect(classifyDisplayEntry(lab)).toEqual({ kind: 'console', reason: 'vendor' })
  })

  it('falls back on "no vendor name and no IOMMU group" for an unknown emulated adapter', () => {
    expect(classifyDisplayEntry({ id: '0000:00:05.0', class: '0x030000', vendor: '0xabcd', device: '0x0001', iommugroup: -1 })).toEqual({ kind: 'console', reason: 'emulated' })
    // A real GPU on a host without IOMMU keeps counting as a GPU.
    expect(classifyDisplayEntry({ id: '0000:05:00.0', class: '0x030000', vendor: '0x1002', device: '0x744c', vendor_name: 'AMD', iommugroup: -1 })).toEqual({ kind: 'gpu', reason: null })
  })
})

describe('parseHostpciEntries', () => {
  it('reads raw addresses, host= lists, mappings and mdev profiles', () => {
    const refs = parseHostpciEntries({
      hostpci1: 'host=02:00.0;03:00.0,pcie=1',
      hostpci0: '0000:01:00,pcie=1,x-vga=1',
      hostpci10: 'mapping=a100,mdev=nvidia-63',
      net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0',
      hostpci2: 42,
    })
    expect(refs).toEqual([
      { slot: 'hostpci0', addresses: [{ slot: '0000:01:00', fn: null }], mapping: null, mdev: null },
      { slot: 'hostpci1', addresses: [{ slot: '0000:02:00', fn: '0' }, { slot: '0000:03:00', fn: '0' }], mapping: null, mdev: null },
      { slot: 'hostpci10', addresses: [], mapping: 'a100', mdev: 'nvidia-63' },
    ])
    expect(parseHostpciEntries(null)).toEqual([])
  })
})

describe('parsePciMappings', () => {
  it('accepts property strings and objects, drops entries without node or path', () => {
    const out = parsePciMappings([
      ...MAPPINGS_RAW,
      { id: 'obj', map: [{ node: 'n1', path: '0000:05:00' }, { node: 'n1' }, 'path=0000:06:00.0'] },
      { map: [] },
      null,
    ])
    expect(out).toEqual([
      { id: 'a100', mdev: false, entries: [{ node: 'gpu1', paths: [{ slot: '0000:41:00', fn: '0' }] }, { node: 'gpu2', paths: [{ slot: '0000:41:00', fn: '0' }] }] },
      { id: 'obj', mdev: false, entries: [{ node: 'n1', paths: [{ slot: '0000:05:00', fn: null }] }] },
    ])
    expect(parsePciMappings('x')).toEqual([])
  })
})

describe('collectNodeDevices', () => {
  const mappings = parsePciMappings(MAPPINGS_RAW)
  const devices = collectNodeDevices('c1', 'gpu1', GPU_HOST, mappings)

  it('keeps one device per slot holding a display function, audio function attached', () => {
    expect(devices.map((d) => [d.slot, d.kind])).toEqual([
      ['0000:01:00', 'gpu'],
      ['0000:03:00', 'console'],
      ['0000:41:00', 'gpu'],
    ])
    const rtx = devices[0]
    expect(rtx.id).toBe('0000:01:00.0')
    expect(rtx.functions).toEqual(['0000:01:00.0', '0000:01:00.1'])
    expect(rtx.displayFunctions).toEqual(['0000:01:00.0'])
    expect(rtx.subsystemName).toBe('ASUSTeK Computer Inc. Device 87b3')
    expect(rtx.key).toBe('c1:gpu1:0000:01:00')
  })

  it('reports IOMMU isolation, mdev support and the mappings of each device', () => {
    const [rtx, aspeed, a100] = devices
    expect(rtx.iommuIsolated).toBe(true)
    // The ASPEED shares group 7 with the NIC of another slot.
    expect(aspeed.iommuIsolated).toBe(false)
    expect(a100.mdev).toBe(true)
    expect(a100.mappings).toEqual(['a100'])
    expect(rtx.mappings).toEqual([])
  })

  it('names a device PVE could not name, and survives junk rows', () => {
    const lab = collectNodeDevices('c1', 'pve1', [
      { id: '0000:00:02.0', class: '0x030000', vendor: '0x1234', device: '0x1111', iommugroup: -1 },
      { id: 'garbage', class: '0x030000' } as PvePciEntry,
    ])
    expect(lab).toHaveLength(1)
    expect(lab[0]).toMatchObject({ vendorName: 'QEMU/Bochs', deviceName: 'Standard VGA (emulated)', iommuGroup: null, iommuIsolated: false, kind: 'console' })
  })

  it('matches a slot address against every display function, a function address against its own', () => {
    const rtx = devices[0]
    expect(addressMatchesDevice({ slot: '0000:01:00', fn: null }, rtx)).toBe(true)
    expect(addressMatchesDevice({ slot: '0000:01:00', fn: '0' }, rtx)).toBe(true)
    expect(addressMatchesDevice({ slot: '0000:01:00', fn: '1' }, rtx)).toBe(false)
    expect(addressMatchesDevice({ slot: '0000:02:00', fn: null }, rtx)).toBe(false)
  })
})

describe('resolveAllocations and computeCapacity on a simulated GPU host', () => {
  const mappings = parsePciMappings(MAPPINGS_RAW)
  const devices = collectNodeDevices('c1', 'gpu1', GPU_HOST, mappings)

  it('maps 01:00 without function, a mapping, and ignores the audio-only passthrough', () => {
    const guests = [
      guest('100', 'running', { hostpci0: '01:00,pcie=1,x-vga=1' }),
      guest('101', 'stopped', { hostpci0: 'mapping=a100,mdev=nvidia-63' }, { pool: 'tenant-a', tags: ['ml'] }),
      guest('102', 'stopped', { hostpci0: '0000:01:00.1' }),
      guest('103', 'running', { hostpci0: '01:00' }, { node: 'gpu2' }),
      guest('104', 'running', { scsi0: 'local:vm-104-disk-0' }),
    ]
    const allocations = resolveAllocations('c1', devices, mappings, guests)
    expect(allocations.map((a) => [a.vmid, a.deviceKey, a.via, a.mapping, a.mdev, a.pooled])).toEqual([
      ['100', 'c1:gpu1:0000:01:00', 'address', null, null, false],
      ['101', 'c1:gpu1:0000:41:00', 'mapping', 'a100', 'nvidia-63', false],
    ])
    expect(allocations[1]).toMatchObject({ pool: 'tenant-a', tags: ['ml'], hostpci: 'hostpci0', vmStatus: 'stopped' })

    expect(computeCapacity(devices, allocations)).toEqual({ total: 2, allocated: 2, free: 0, inUse: 1, consoles: 1 })
  })

  it('flags the hostpciN whose removal is pending, and only that one', () => {
    const allocations = resolveAllocations('c1', devices, mappings, [
      { ...guest('100', 'running', { hostpci0: '01:00', hostpci1: 'mapping=a100,mdev=nvidia-63' }), pendingDelete: ['hostpci1'] },
      guest('101', 'running', { hostpci0: '0000:01:00.0' }),
    ])
    expect(allocations.map((a) => [a.vmid, a.hostpci, a.pendingRemoval])).toEqual([
      ['100', 'hostpci0', false],
      ['100', 'hostpci1', true],
      ['101', 'hostpci0', false],
    ])
  })

  it('leaves a GPU free when no config points at it', () => {
    const allocations = resolveAllocations('c1', devices, mappings, [guest('100', 'stopped', { hostpci0: '01:00.0' })])
    expect(computeCapacity(devices, allocations)).toEqual({ total: 2, allocated: 1, free: 1, inUse: 0, consoles: 1 })
  })

  it('counts a GPU once even when two VM configs share it', () => {
    const allocations = resolveAllocations('c1', devices, mappings, [
      guest('100', 'stopped', { hostpci0: '01:00' }),
      guest('101', 'running', { hostpci0: '0000:01:00.0' }),
    ])
    expect(allocations).toHaveLength(2)
    expect(computeCapacity(devices, allocations)).toMatchObject({ allocated: 1, inUse: 1 })
  })

  it('spreads the running guests of a pooled mapping over distinct devices and flags the guess', () => {
    const pool = parsePciMappings([
      { id: 'pool', map: ['node=gpu1,path=0000:01:00', 'node=gpu1,path=0000:41:00.0'] },
    ])
    const allocations = resolveAllocations('c1', devices, pool, [
      guest('200', 'running', { hostpci0: 'mapping=pool' }),
      guest('201', 'running', { hostpci0: 'mapping=pool' }),
      guest('202', 'running', { hostpci0: 'mapping=unknown' }),
    ])
    expect(allocations.map((a) => [a.vmid, a.deviceKey, a.pooled])).toEqual([
      ['200', 'c1:gpu1:0000:01:00', true],
      ['201', 'c1:gpu1:0000:41:00', true],
    ])
  })

  it('reads nothing for a guest whose node has no display device', () => {
    expect(resolveAllocations('c1', devices, mappings, [guest('300', 'running', { hostpci0: '01:00' }, { node: 'other' })])).toEqual([])
  })
})

// /nodes/pve9-a5000/hardware/pci once the RTX A5000 is in vGPU mode
// (display off, NVIDIA vGPU host driver, SR-IOV on): the card and 24 virtual
// functions spread over slots 03:00 to 03:03.
const A5000_VFS = Array.from({ length: 24 }, (_, i) => {
  const n = i + 4
  return `0000:03:0${Math.floor(n / 8)}.${n % 8}`
})
const VGPU_HOST: PvePciEntry[] = [
  {
    id: '0000:03:00.0', class: '0x030200', vendor: '0x10de', device: '0x2231', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [RTX A5000]', iommugroup: 35,
    virtfns: Object.fromEntries(A5000_VFS.map((v, i) => [`virtfn${i}`, v])),
  },
  ...A5000_VFS.map((id, i) => ({
    id, class: '0x030200', vendor: '0x10de', device: '0x2231', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [RTX A5000]', iommugroup: 116 + i, mdev: 1, physfn: '0000:03:00.0', subsystem_vendor: '0x10de', subsystem_device: '0x0000',
  })),
  { id: '0000:08:00.0', class: '0x030000', vendor: '0x102b', device: '0x0532', vendor_name: 'Matrox Electronics Systems Ltd.', device_name: 'MGA G200eW WPCM450', iommugroup: 20 },
]
const VGPU_MAPPING = parsePciMappings([
  { id: 'a5000-vgpu', mdev: 1, map: A5000_VFS.map((p, i) => `node=gpu1,path=${p},id=10de:2231,subsystem-id=10de:0000,iommugroup=${116 + i}`) },
  { id: 'whole-card', map: ['node=gpu1,path=0000:03:00,id=10de:2231,iommugroup=35'] },
])

describe('a card shared out as vGPUs (SR-IOV)', () => {
  const devices = collectNodeDevices('c1', 'gpu1', VGPU_HOST, VGPU_MAPPING)
  const card = devices.find((d) => d.kind === 'gpu')!

  it('folds the 24 virtual functions into one GPU, its vGPU slots', () => {
    expect(devices.filter((d) => d.kind === 'gpu')).toHaveLength(1)
    expect(card.id).toBe('0000:03:00.0')
    expect(card.mdev).toBe(true)
    expect(card.vgpu?.mode).toBe('sriov')
    expect(card.vgpu?.virtualFunctions).toEqual([...A5000_VFS].sort((a, b) => a.localeCompare(b)))
    expect(card.vgpu?.iommuGroups?.[0]).toBe(116)
    expect(card.vgpu?.subsystemId).toBe('10de:0000')
    expect(VGPU_MAPPING.map((m) => [m.id, m.mdev])).toEqual([['a5000-vgpu', true], ['whole-card', false]])
    expect(card.mappings).toEqual(['a5000-vgpu', 'whole-card'])
    expect(addressMatchesDevice(parsePciAddress('03:02.5')!, card)).toBe(true)
    expect(addressMatchesDevice(parsePciAddress('03:01')!, card)).toBe(true)
  })

  it('puts every vGPU guest on the card, without a pool guess, and counts the card once', () => {
    const allocations = resolveAllocations('c1', devices, VGPU_MAPPING, [
      guest('9010', 'running', { hostpci0: 'mapping=a5000-vgpu,mdev=nvidia-665,pcie=1' }),
      guest('9011', 'running', { hostpci0: 'mapping=a5000-vgpu,mdev=nvidia-665,pcie=1' }),
    ])
    expect(allocations.map((a) => [a.vmid, a.deviceKey, a.mdev, a.pooled])).toEqual([
      ['9010', card.key, 'nvidia-665', false],
      ['9011', card.key, 'nvidia-665', false],
    ])
    expect(computeCapacity(devices, allocations)).toEqual({ total: 1, allocated: 1, free: 0, inUse: 1, consoles: 1 })
  })

  it('keeps an older mediated-device card (vGPU on the card itself) as one GPU too', () => {
    const [a100] = collectNodeDevices('c1', 'gpu1', GPU_HOST, []).filter((d) => d.id === '0000:41:00.0')
    expect(a100.vgpu).toEqual({ mode: 'mdev', virtualFunctions: [] })
  })
})
