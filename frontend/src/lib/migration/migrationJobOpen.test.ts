import { afterEach, describe, expect, it, vi } from 'vitest'

import { OPEN_BULK_BATCH_EVENT, type OpenBulkBatchDetail } from './bulkBatchOpen'
import {
  migrationFromTaskCenterJob, migrationDialogVm, migrationJobInventoryUrl, openMigration, OPEN_MIGRATION_JOB_EVENT, requestOpenMigrationJob, type OpenMigrationJobDetail,
} from './migrationJobOpen'

// The node project has no DOM: a minimal window with an EventTarget is enough.
const g = globalThis as any
if (!('window' in g)) g.window = new EventTarget()
g.CustomEvent = g.CustomEvent ?? class<T> extends Event { detail: T; constructor(type: string, init: { detail: T }) { super(type); this.detail = init.detail } }

const listen = <T extends { handled: boolean }>(type: string, take = true) => {
  const seen: T[] = []
  const on = (e: Event) => { const d = (e as CustomEvent<T>).detail; seen.push(d); if (take) d.handled = true }
  window.addEventListener(type, on)
  return { seen, off: () => window.removeEventListener(type, on) }
}

describe('migrationJobOpen', () => {
  const offs: Array<() => void> = []
  afterEach(() => { offs.splice(0).forEach(f => f()) })

  it('asks a mounted Inventory page first, and reports whether it took the run', () => {
    expect(requestOpenMigrationJob('j1')).toBe(false)
    const l = listen<OpenMigrationJobDetail>(OPEN_MIGRATION_JOB_EVENT)
    offs.push(l.off)
    expect(requestOpenMigrationJob('j1')).toBe(true)
    expect(l.seen[0]).toMatchObject({ jobId: 'j1' })
  })

  it('lands on the source host of the run, with the run to reopen', () => {
    expect(migrationJobInventoryUrl('j 1', 'vc&1')).toBe('/infrastructure/inventory?selectType=ext&selectId=vc%261&openMigration=j+1')
    // a row of this tab only knows its run: the page opens it without a host behind
    expect(migrationJobInventoryUrl('j1')).toBe('/infrastructure/inventory?openMigration=j1')
  })

  it('rebuilds the migrate dialog of a run from its record alone', () => {
    expect(migrationDialogVm({ id: 'j1', sourceConnectionId: 'vc1', sourceVmId: 'vm-20128', sourceVmName: 'i317-src', config: { sourceType: 'vcenter' } }))
      .toEqual({ vmid: 'vm-20128', name: 'i317-src', connId: 'vc1', connName: '', hostType: 'vcenter', restoreJobId: 'j1' })
    // the pipelines store a direct ESXi source as esxi or vmware: the dialog knows it as vmware
    for (const sourceType of ['esxi', 'esxi-direct', 'vmware']) {
      expect(migrationDialogVm({ id: 'j', sourceConnectionId: 'e', sourceVmId: '1', config: { sourceType } }).hostType).toBe('vmware')
    }
    for (const sourceType of ['xcpng', 'hyperv', 'nutanix']) {
      expect(migrationDialogVm({ id: 'j', sourceConnectionId: 'x', sourceVmId: '1', config: { sourceType } }).hostType).toBe(sourceType)
    }
    expect(migrationDialogVm({ id: 'j', sourceConnectionId: 'x', sourceVmId: 'vm-9', sourceVmName: null, config: null }).name).toBe('vm-9')
  })

  describe('openMigration', () => {
    it('reopens the dialog that started the run when this tab still holds it', () => {
      const navigate = vi.fn()
      const restore = vi.fn(() => true)
      openMigration({ id: 'j1', sourceConnectionId: 'vc1', batchId: null }, { restore, navigate })
      expect(restore).toHaveBeenCalledWith('migration-j1')
      expect(navigate).not.toHaveBeenCalled()
    })

    it('else lets a mounted Inventory page reopen it, else goes there', () => {
      const navigate = vi.fn()
      const l = listen<OpenMigrationJobDetail>(OPEN_MIGRATION_JOB_EVENT)
      offs.push(l.off)
      openMigration({ id: 'j1', sourceConnectionId: 'vc1', batchId: null }, { restore: () => false, navigate })
      expect(l.seen).toHaveLength(1)
      expect(navigate).not.toHaveBeenCalled()
      l.off()

      openMigration({ id: 'j1', sourceConnectionId: 'vc1', batchId: null }, { restore: () => false, navigate })
      expect(navigate).toHaveBeenCalledWith('/infrastructure/inventory?selectType=ext&selectId=vc1&openMigration=j1')
    })

    it('opens the follow-up of its batch for a run of a bulk migration, its original dialog', () => {
      const navigate = vi.fn()
      const single = listen<OpenMigrationJobDetail>(OPEN_MIGRATION_JOB_EVENT)
      offs.push(single.off)
      openMigration({ id: 'j1', sourceConnectionId: 'vc1', batchId: 'b1' }, { restore: () => false, navigate })
      expect(single.seen).toHaveLength(0)
      expect(navigate).toHaveBeenCalledWith('/infrastructure/inventory?selectType=ext&selectId=vc1&openBatch=b1')

      const batch = listen<OpenBulkBatchDetail>(OPEN_BULK_BATCH_EVENT)
      offs.push(batch.off)
      navigate.mockClear()
      openMigration({ id: 'j1', sourceConnectionId: 'vc1', batchId: 'b1' }, { restore: () => false, navigate })
      expect(batch.seen[0]).toMatchObject({ batchId: 'b1', sourceConnectionId: 'vc1' })
      expect(navigate).not.toHaveBeenCalled()
    })
  })
})

describe('migrationFromTaskCenterJob', () => {
  it('reads a migration of the Task Center as the run to reopen', () => {
    expect(migrationFromTaskCenterJob({ id: 'j1', type: 'migration', metadata: { sourceConnectionId: 'vc1', batchId: 'b1' } }))
      .toEqual({ id: 'j1', sourceConnectionId: 'vc1', batchId: 'b1' })
    // a row from a feed without the source still reopens the run, without its host
    expect(migrationFromTaskCenterJob({ id: 'j2', type: 'migration' })).toEqual({ id: 'j2', sourceConnectionId: null, batchId: null })
  })

  it('leaves the other jobs to their own dialog', () => {
    expect(migrationFromTaskCenterJob({ id: 'r1', type: 'rolling_update', metadata: {} })).toBeNull()
    expect(migrationFromTaskCenterJob(null)).toBeNull()
  })
})
