import { describe, it, expect } from 'vitest'
import { proposeAddresses, nextWorkerNames, planWorkers, MAX_WORKERS_PER_CHANGE } from './workers'
import type { WorkerLayout } from './provisionOrchestrator'

const layout: WorkerLayout = {
  controlPlane: [{ name: 'dev-cp-1', ip: '10.42.0.87', vmid: 98511 }],
  workers: [{ name: 'dev-worker-1', ip: '10.42.0.88', vmid: 98512 }],
  gateway: '10.42.0.1',
  subnetPrefix: 24,
  workerCores: 2,
  workerMemory: 2048,
  workerDisk: 12,
  changeable: true,
}

describe('proposeAddresses', () => {
  it('follows the highest node address and VMID', () => {
    expect(proposeAddresses(layout, 2)).toEqual([{ ip: '10.42.0.89', vmid: 98513 }, { ip: '10.42.0.90', vmid: 98514 }])
  })
  it('skips the gateway, the virtual IP and addresses already taken', () => {
    const l = { ...layout, controlPlaneVip: '10.42.0.89' }
    expect(proposeAddresses(l, 1, ['10.42.0.90'])).toEqual([{ ip: '10.42.0.91', vmid: 98513 }])
  })
  it('stops at the end of the subnet', () => {
    const l = { ...layout, workers: [{ name: 'dev-worker-1', ip: '10.42.0.253', vmid: 98512 }] }
    expect(proposeAddresses(l, 3)).toEqual([{ ip: '10.42.0.254', vmid: 98513 }])
  })
  it('ignores an unreadable address', () => {
    const l = { ...layout, workers: [{ name: 'dev-worker-1', ip: 'not-an-ip', vmid: 98512 }] }
    expect(proposeAddresses(l, 1)).toEqual([{ ip: '10.42.0.88', vmid: 98513 }])
  })
})

describe('nextWorkerNames', () => {
  it('continues after the highest worker number', () => {
    const l = { ...layout, workers: [...layout.workers, { name: 'dev-worker-4', ip: '10.42.0.92', vmid: 98515 }] }
    expect(nextWorkerNames('dev', l, 2)).toEqual(['dev-worker-5', 'dev-worker-6'])
  })
  it('starts at 1 on a cluster without workers', () => {
    expect(nextWorkerNames('dev', { ...layout, workers: [] }, 1)).toEqual(['dev-worker-1'])
  })
})

describe('planWorkers', () => {
  it('adds named workers and keeps the others', () => {
    const p = planWorkers('dev', layout, [{ ip: '10.42.0.89', vmid: 98513 }], [])
    expect(p.ok && p.workers.map(w => w.name)).toEqual(['dev-worker-1', 'dev-worker-2'])
    expect(p.ok && p.added).toEqual([{ name: 'dev-worker-2', ip: '10.42.0.89', vmid: 98513 }])
  })
  it('removes a worker', () => {
    const p = planWorkers('dev', layout, [], ['dev-worker-1'])
    expect(p.ok && p.workers).toEqual([])
  })
  it('refuses removing a control plane node, an empty change and too many workers', () => {
    expect(planWorkers('dev', layout, [], ['dev-cp-1'])).toEqual({ ok: false, error: 'not_a_worker' })
    expect(planWorkers('dev', layout, [], [])).toEqual({ ok: false, error: 'nothing_to_change' })
    const many = Array.from({ length: MAX_WORKERS_PER_CHANGE + 1 }, (_, i) => ({ ip: `10.42.0.${100 + i}`, vmid: 99000 + i }))
    expect(planWorkers('dev', layout, many, [])).toEqual({ ok: false, error: 'too_many' })
  })
})
