import { describe, expect, it } from 'vitest'

import type { VisibleVgpuType } from './metricsShared'
import { buildMyGpuHours, type HoursRow } from './vdcHours'

const DEV = 'c1:pve-secret-node:0000:03:00'
const catalog: VisibleVgpuType[] = [{ deviceKey: DEV, typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 }]

const row = (over: Partial<HoursRow> = {}): HoursRow => ({
  vmid: 101, vmName: 'web', deviceKey: DEV, modelName: 'RTX A5000', mdev: 'nvidia-665', runningSeconds: 3600, reservedSeconds: 3600, ...over,
})

describe('buildMyGpuHours', () => {
  it('answers an empty month with zeros', () => {
    expect(buildMyGpuHours('2026-11', [], catalog)).toEqual({ month: '2026-11', totals: { runningHours: 0, reservedHours: 0 }, byVm: [], byProfile: [] })
  })

  it('labels a vGPU with its catalog profile and sums the hours per VM and per profile', () => {
    const out = buildMyGpuHours('2026-11', [row(), row({ runningSeconds: 1800, reservedSeconds: 3600 }), row({ vmid: 102, vmName: 'db' })], catalog)
    expect(out.totals).toEqual({ runningHours: 2.5, reservedHours: 3 })
    expect(out.byVm).toEqual([
      { vmid: '101', vmName: 'web', label: 'RTXA5000-12Q', runningHours: 1.5, reservedHours: 2 },
      { vmid: '102', vmName: 'db', label: 'RTXA5000-12Q', runningHours: 1, reservedHours: 1 },
    ])
    expect(out.byProfile).toEqual([{ label: 'RTXA5000-12Q', runningHours: 2.5, reservedHours: 3 }])
  })

  it('falls back to "vGPU <model>" when the profile is not in the catalog', () => {
    const out = buildMyGpuHours('2026-11', [row({ mdev: 'nvidia-999' })], catalog)
    expect(out.byVm[0].label).toBe('vGPU RTX A5000')
    expect(buildMyGpuHours('2026-11', [row()], []).byVm[0].label).toBe('vGPU RTX A5000')
  })

  it('labels a whole card with its model name', () => {
    const out = buildMyGpuHours('2026-11', [row({ mdev: null, modelName: 'L40S' })], catalog)
    expect(out.byVm[0].label).toBe('L40S')
    expect(out.byProfile[0].label).toBe('L40S')
  })

  it('rounds the hours to 0.01', () => {
    const out = buildMyGpuHours('2026-11', [row({ runningSeconds: 1000, reservedSeconds: 2000 })], catalog)
    expect(out.byVm[0].runningHours).toBe(0.28)
    expect(out.byVm[0].reservedHours).toBe(0.56)
    expect(out.totals).toEqual({ runningHours: 0.28, reservedHours: 0.56 })
  })

  it('sorts the VMs by running hours, the most used first', () => {
    const out = buildMyGpuHours('2026-11', [
      row({ vmid: 1, vmName: 'a', runningSeconds: 3600 }),
      row({ vmid: 2, vmName: 'b', runningSeconds: 7200 }),
      row({ vmid: 3, vmName: 'c', runningSeconds: 1800 }),
    ], catalog)
    expect(out.byVm.map(v => v.vmid)).toEqual(['2', '1', '3'])
  })

  it('gives a VM one line per profile it held, never a joined label', () => {
    const out = buildMyGpuHours('2026-11', [
      row(),
      row({ mdev: null, modelName: 'L40S', deviceKey: 'c1:n:0000:04:00', runningSeconds: 7200 }),
      row({ runningSeconds: 1800 }),
    ], catalog)
    expect(out.byVm).toEqual([
      { vmid: '101', vmName: 'web', label: 'L40S', runningHours: 2, reservedHours: 1 },
      { vmid: '101', vmName: 'web', label: 'RTXA5000-12Q', runningHours: 1.5, reservedHours: 2 },
    ])
    expect(out.byProfile.map(p => p.label)).toEqual(['L40S', 'RTXA5000-12Q'])
    expect(out.totals.runningHours).toBe(3.5)
  })

  it('breaks ties by VMID then label, whatever the order of the rows', () => {
    const rows = [
      row({ vmid: 20, vmName: 'b' }),
      row({ vmid: 3, vmName: 'a', mdev: null, modelName: 'L40S' }),
      row({ vmid: 3, vmName: 'a' }),
    ]
    const expected = ['3:L40S', '3:RTXA5000-12Q', '20:RTXA5000-12Q']
    expect(buildMyGpuHours('2026-11', rows, catalog).byVm.map(v => `${v.vmid}:${v.label}`)).toEqual(expected)
    expect(buildMyGpuHours('2026-11', [...rows].reverse(), catalog).byVm.map(v => `${v.vmid}:${v.label}`)).toEqual(expected)
    const tied = [row({ vmid: 1 }), row({ vmid: 2, mdev: null, modelName: 'L40S' })]
    expect(buildMyGpuHours('2026-11', tied, catalog).byProfile.map(p => p.label)).toEqual(['L40S', 'RTXA5000-12Q'])
    expect(buildMyGpuHours('2026-11', [...tied].reverse(), catalog).byProfile.map(p => p.label)).toEqual(['L40S', 'RTXA5000-12Q'])
  })

  it('shows the latest name of a renamed VM', () => {
    const out = buildMyGpuHours('2026-11', [row({ vmName: 'old' }), row({ vmName: 'new' })], catalog)
    expect(out.byVm).toHaveLength(1)
    expect(out.byVm[0].vmName).toBe('new')
  })

  it('never carries a price, a currency, a node or a device key', () => {
    const json = JSON.stringify(buildMyGpuHours('2026-11', [row()], catalog))
    for (const word of ['cost', 'price', 'currency', 'node', 'deviceKey', 'pve-secret-node', DEV]) expect(json).not.toContain(word)
  })
})
