import { describe, expect, it } from 'vitest'

import { runningVersions, serviceRows } from './services'
import type { CephInventory } from './types'

const mon = (name: string, over: Record<string, unknown> = {}) => ({
  name, host: name, addr: '10.0.0.1:6789/0', rank: 0, inQuorum: true, leader: false, version: '20.2.4', storeStats: null, ...over,
})
const mgr = (name: string, version: string | null = '20.2.4') => ({ name, host: name, version, addr: '10.0.0.1' })

function inventory(over: { mons?: unknown[]; active?: unknown; standbys?: unknown[]; stopped?: unknown[] | undefined; mds?: unknown[] }): CephInventory {
  return {
    pveNodes: ['pve1', 'pve2', 'pve3'],
    osds: { list: [] },
    monitors: { list: over.mons ?? [mon('pve1')] },
    managers: { active: over.active === undefined ? mgr('pve1') : over.active, standbys: over.standbys ?? [mgr('pve2')], stopped: over.stopped },
    mds: { list: over.mds ?? [] },
  } as unknown as CephInventory
}

describe('serviceRows, stopped daemons', () => {
  it('lists a stopped manager with its node, not running (so Start is available), as a warning', () => {
    const rows = serviceRows(inventory({ stopped: [mgr('pve3', null)] }))
    const stopped = rows.find(r => r.service === 'mgr.pve3')

    expect(stopped).toMatchObject({ kind: 'mgr', state: 'stopped', dot: 'warn', running: false, node: 'pve3', host: 'pve3', version: null, rawState: null })
    expect(rows.find(r => r.service === 'mgr.pve1')).toMatchObject({ state: 'active', running: true })
    expect(rows.find(r => r.service === 'mgr.pve2')).toMatchObject({ state: 'standby', running: true })
  })

  it('reads an inventory without the stopped list (older server) like before', () => {
    const rows = serviceRows(inventory({ stopped: undefined }))

    expect(rows.filter(r => r.kind === 'mgr').map(r => r.service)).toEqual(['mgr.pve1', 'mgr.pve2'])
  })

  it('does not count a stopped manager among the versions that run', () => {
    const inv = inventory({ stopped: [mgr('pve3', '19.2.1')] })

    expect(runningVersions(inv, serviceRows(inv))).toEqual([{ version: '20.2.4', count: 3 }])
  })

  it('lists a monitor PVE reports stopped as stopped and not running, whatever its quorum flag', () => {
    const row = serviceRows(inventory({ mons: [mon('pve1'), mon('pve3', { inQuorum: false, state: 'stopped' })] })).find(r => r.service === 'mon.pve3')

    expect(row).toMatchObject({ state: 'stopped', dot: 'warn', running: false })
  })

  it('keeps a running monitor out of quorum as out of quorum', () => {
    const row = serviceRows(inventory({ mons: [mon('pve3', { inQuorum: false, state: 'running' })] })).find(r => r.service === 'mon.pve3')

    expect(row).toMatchObject({ state: 'outOfQuorum', dot: 'warn', running: false })
  })

  it('lists a metadata server PVE reports stopped as stopped, not running, with no raw state shown', () => {
    const row = serviceRows(inventory({ mds: [{ name: 'pve3', host: 'pve3', addr: '', state: 'stopped' }] })).find(r => r.service === 'mds.pve3')

    expect(row).toMatchObject({ state: 'stopped', dot: 'warn', running: false, rawState: null, node: 'pve3' })
  })

  it('still shows an unknown MDS state as is', () => {
    const row = serviceRows(inventory({ mds: [{ name: 'pve3', host: 'pve3', addr: '', state: 'up:boot' }] })).find(r => r.service === 'mds.pve3')

    expect(row).toMatchObject({ state: 'other', rawState: 'up:boot' })
  })

  it('an mds in up:stopping keeps its raw state (it is still running), stopped means stopped', () => {
    const stateOf = (state: string) => serviceRows(inventory({ mds: [{ name: 'pve3', host: 'pve3', addr: '', state }] })).find(r => r.service === 'mds.pve3')

    expect(stateOf('up:stopping')).toMatchObject({ state: 'other', running: true, rawState: 'up:stopping' })
    expect(stateOf('stopped')).toMatchObject({ state: 'stopped', running: false })
  })
})
