import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import en from '@/messages/en.json'
import { formatBytes } from '@/utils/format'

import { computeNodeProvisioning, describeNodeProvisioning, formatRatio } from './nodeProvisioning'

const CAPACITY = { logicalCpus: 32, memBytes: 128 * 1024 ** 3 }

const guest = (over: Partial<Parameters<typeof computeNodeProvisioning>[0][number]> = {}) => ({
  status: 'running',
  template: false,
  maxcpu: 4,
  maxmem: 8 * 1024 ** 3,
  ...over,
})

describe('computeNodeProvisioning (#969)', () => {
  it('reports nothing for a node that holds no guest', () => {
    expect(computeNodeProvisioning([], CAPACITY)).toBeNull()
  })

  it('reports nothing for a node that holds only templates', () => {
    const vms = [guest({ template: true, status: 'stopped' }), guest({ template: true, status: 'stopped' })]

    expect(computeNodeProvisioning(vms, CAPACITY)).toBeNull()
  })

  it('sums every non-template guest into the "all" figures', () => {
    const vms = [guest(), guest({ status: 'stopped' }), guest({ status: 'paused' })]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.vcpu.all).toBe(12)
    expect(result?.memory.all).toBe(24 * 1024 ** 3)
    expect(result?.guests.all).toBe(3)
  })

  it('counts only running guests into the "running" figures', () => {
    const vms = [guest(), guest({ status: 'stopped' }), guest({ status: 'paused' })]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.vcpu.running).toBe(4)
    expect(result?.memory.running).toBe(8 * 1024 ** 3)
    expect(result?.guests.running).toBe(1)
  })

  it('excludes templates from the totals of a node that also runs real guests', () => {
    const vms = [guest(), guest({ template: true, status: 'stopped', maxcpu: 64, maxmem: 512 * 1024 ** 3 })]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.vcpu.all).toBe(4)
    expect(result?.memory.all).toBe(8 * 1024 ** 3)
    expect(result?.guests.all).toBe(1)
  })

  it('expresses the ratios against the node capacity it was given', () => {
    const vms = [guest({ maxcpu: 24, maxmem: 96 * 1024 ** 3 })]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.vcpu.runningRatio).toBeCloseTo(0.75)
    expect(result?.memory.runningRatio).toBeCloseTo(0.75)
  })

  it('reports an overcommit ratio above 1 without clamping it', () => {
    const vms = [guest({ maxcpu: 48, maxmem: 192 * 1024 ** 3 })]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.vcpu.allRatio).toBeCloseTo(1.5)
    expect(result?.memory.allRatio).toBeCloseTo(1.5)
  })

  it('leaves a ratio undefined when the node reports no capacity for it', () => {
    const vms = [guest()]

    const result = computeNodeProvisioning(vms, { logicalCpus: 0, memBytes: 0 })

    expect(result?.vcpu.allRatio).toBeUndefined()
    expect(result?.memory.allRatio).toBeUndefined()
    expect(result?.vcpu.all).toBe(4)
  })

  it('treats a guest whose allocation Proxmox did not report as zero', () => {
    const vms = [guest({ maxcpu: undefined, maxmem: undefined }), guest()]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.vcpu.all).toBe(4)
    expect(result?.memory.all).toBe(8 * 1024 ** 3)
    expect(Number.isFinite(result?.vcpu.allRatio as number)).toBe(true)
  })

  it('keeps counting a guest with no allocation among the node guests', () => {
    const vms = [guest({ maxcpu: undefined, maxmem: undefined })]

    const result = computeNodeProvisioning(vms, CAPACITY)

    expect(result?.guests.all).toBe(1)
    expect(result?.vcpu.all).toBe(0)
  })

  it('carries the capacity it was given, so the tooltip can state the reference', () => {
    const result = computeNodeProvisioning([guest()], CAPACITY)

    expect(result?.capacity).toEqual({ logicalCpus: 32, memBytes: 128 * 1024 ** 3 })
  })
})

describe('formatRatio (#969)', () => {
  it('writes a whole ratio without decimals', () => {
    expect(formatRatio(1)).toBe('1×')
  })

  it('keeps the decimals that carry meaning and drops the ones that do not', () => {
    expect(formatRatio(1.5)).toBe('1.5×')
    expect(formatRatio(0.75)).toBe('0.75×')
    expect(formatRatio(4 / 3)).toBe('1.33×')
  })

  it('never rounds a real allocation down to nothing', () => {
    expect(formatRatio(0.002)).toBe('<0.01×')
  })

  it('writes an exact zero as zero', () => {
    expect(formatRatio(0)).toBe('0×')
  })

  it('has nothing to write without a ratio', () => {
    expect(formatRatio(undefined)).toBeNull()
  })
})

describe('describeNodeProvisioning (#969)', () => {
  // The real English catalogue, so a label that lost a placeholder fails here
  // rather than in the browser.
  const t = createTranslator({ locale: 'en', messages: en as any }) as unknown as (
    key: string,
    values?: Record<string, unknown>
  ) => string

  const describeFor = (vms: Parameters<typeof computeNodeProvisioning>[0], capacity = CAPACITY) =>
    describeNodeProvisioning(computeNodeProvisioning(vms, capacity)!, { t, formatBytes })

  const OVERCOMMITTED = [guest({ maxcpu: 24, maxmem: 96 * 1024 ** 3 }), guest({ status: 'stopped', maxcpu: 24, maxmem: 96 * 1024 ** 3 })]

  it('puts the total ratio on the chip, the figure that signals overcommit', () => {
    const { cpu, memory } = describeFor(OVERCOMMITTED)

    expect(cpu.chip).toBe('1.5×')
    expect(memory.chip).toBe('1.5×')
  })

  it('flags the chip as an overcommit only once the total passes capacity', () => {
    expect(describeFor(OVERCOMMITTED).cpu.overcommitted).toBe(true)
    expect(describeFor([guest({ maxcpu: 4 })]).cpu.overcommitted).toBe(false)
  })

  it('names the chip for assistive tech, since "1.5×" alone says nothing', () => {
    const { cpu } = describeFor(OVERCOMMITTED)

    expect(cpu.chipLabel).toContain('1.5×')
    expect(cpu.chipLabel!.length).toBeGreaterThan('1.5×'.length)
  })

  it('names the resource in the title, since a ratio alone says nothing', () => {
    const { cpu, memory } = describeFor(OVERCOMMITTED)

    expect(cpu.tooltip.title).toBe('vCPU provisioned to guests')
    expect(memory.tooltip.title).toBe('Memory provisioned to guests')
  })

  it('counts the guests behind each figure and says what the ratio divides', () => {
    const { cpu } = describeFor(OVERCOMMITTED)

    expect(cpu.tooltip.rows).toEqual([
      { label: '1 running guest', value: '24 vCPU', ratio: '0.75× capacity' },
      { label: '2 guests in total', value: '48 vCPU', ratio: '1.5× capacity' },
    ])
  })

  it('agrees the guest count in number', () => {
    const { cpu } = describeFor([guest(), guest(), guest({ status: 'stopped' })])

    expect(cpu.tooltip.rows[0].label).toBe('2 running guests')
    expect(cpu.tooltip.rows[1].label).toBe('3 guests in total')
  })

  it('states the node capacity on both gauges, so each tooltip stands alone', () => {
    const { cpu, memory } = describeFor(OVERCOMMITTED)

    expect(cpu.tooltip.capacity).toBe('Node capacity: 32 logical CPUs')
    expect(memory.tooltip.capacity).toBe('Node capacity: 128 GiB')
  })

  it('states the CPU capacity in logical CPUs, never physical cores', () => {
    expect(describeFor(OVERCOMMITTED).cpu.tooltip.capacity).toContain('logical CPUs')
  })

  it('reads memory in the unit the rest of the summary uses', () => {
    const { memory } = describeFor(OVERCOMMITTED)

    expect(memory.tooltip.rows.map(r => r.value)).toEqual(['96 GiB', '192 GiB'])
  })

  it('positions the marker at the running share of capacity', () => {
    const { cpu, memory } = describeFor(OVERCOMMITTED)

    expect(cpu.markerPct).toBeCloseTo(75)
    expect(memory.markerPct).toBeCloseTo(75)
    expect(cpu.markerLabel).toContain('24 vCPU')
  })

  it('lets the marker run past the bar so the gauge can flag the overflow', () => {
    const { memory } = describeFor([guest({ maxmem: 192 * 1024 ** 3 })])

    expect(memory.markerPct).toBeCloseTo(150)
  })

  it('drops the chip, the ratios and the marker when the node reports no capacity', () => {
    const { cpu, memory } = describeFor([guest({ maxcpu: 24, maxmem: 96 * 1024 ** 3 })], { logicalCpus: 0, memBytes: 0 })

    expect(cpu.chip).toBeUndefined()
    expect(cpu.markerPct).toBeUndefined()
    expect(memory.markerPct).toBeUndefined()
    expect(cpu.tooltip.capacity).toBeUndefined()
    expect(memory.tooltip.capacity).toBeUndefined()
    expect(cpu.tooltip.rows.map(r => r.ratio)).toEqual([undefined, undefined])
  })

  it('still lists the allocations without capacity — they are facts of their own', () => {
    const { cpu } = describeFor([guest({ maxcpu: 24 })], { logicalCpus: 0, memBytes: 0 })

    expect(cpu.tooltip.rows.map(r => r.value)).toEqual(['24 vCPU', '24 vCPU'])
  })
})
