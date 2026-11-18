/**
 * What the plans of a shared policy allow together: one plan per cluster, the Apply button stays one.
 */

import { describe, expect, it } from 'vitest'

import { groupPlanState, planState } from './planState'
import { failedWith, planRun } from './planTestKit'

const DRAFT = 3

describe('groupPlanState', () => {
  it('allows the apply when every cluster has a fresh plan', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: { ...planRun(), id: 'p2', connection_id: 'c2' } },
    ], DRAFT, true, false)
    expect(state.running).toBe(false)
    expect(state.stale).toBe(false)
    expect(state.applicable).toBe(true)
    expect(state.clusters.map(c => c.connectionId)).toEqual(['c1', 'c2'])
  })

  it('refuses the apply when the plan of one cluster comes from an older draft', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: planRun({ version: 2 }) },
    ], DRAFT, true, false)
    expect(state.stale).toBe(true)
    expect(state.staleVersion).toBe(2)
  })

  it('allows the apply when a cluster is unreachable: it catches up later', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: null, error: 'no_client' },
    ], DRAFT, true, false)
    expect(state.applicable).toBe(true)
    expect(state.clusters[1]).toMatchObject({ connectionId: 'c2', error: 'no_client' })
  })

  it('waits while the plan of any cluster is still computed', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: planRun({}, 'running') },
    ], DRAFT, true, false)
    expect(state.running).toBe(true)
    expect(state.applicable).toBe(false)
  })

  it('waits for a cluster whose plan has not answered yet', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: null },
    ], DRAFT, true, false)
    expect(state.running).toBe(true)
    expect(state.applicable).toBe(false)
  })

  it('refuses the apply when one cluster collides or failed', () => {
    expect(groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: planRun({ collisions: ['pcz-web'] }) },
    ], DRAFT, true, false).applicable).toBe(false)
    expect(groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: failedWith(planRun(), 'save failed') },
    ], DRAFT, true, false).applicable).toBe(false)
  })

  it('has nothing to apply when no cluster could plan', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: null, error: 'engine_stopped' },
      { connectionId: 'c2', run: null, error: 'no_client' },
    ], DRAFT, true, false)
    expect(state.running).toBe(false)
    expect(state.applicable).toBe(false)
  })

  it('applies an empty plan of every cluster only when something is pending', () => {
    const empty = [
      { connectionId: 'c1', run: planRun({ plan: [], steps: 0 }) },
      { connectionId: 'c2', run: planRun({ plan: [], steps: 0 }) },
    ]
    expect(groupPlanState(empty, DRAFT, false, false).applicable).toBe(false)
    expect(groupPlanState(empty, DRAFT, true, false).applicable).toBe(true)
  })

  it('gives each cluster the state a single plan would have', () => {
    const run = planRun({ collisions: ['x'] })
    const state = groupPlanState([{ connectionId: 'c1', run }], DRAFT, true, false)
    expect(state.clusters[0].state).toEqual(planState(run, DRAFT, true, false))
  })

  it('marks every plan stale on a version conflict', () => {
    const state = groupPlanState([{ connectionId: 'c1', run: planRun() }, { connectionId: 'c2', run: planRun() }], DRAFT, true, true)
    expect(state.stale).toBe(true)
  })

  it('lets a cluster where nothing can be written now catch up later: unreachable, engine stopped, emergency stop', () => {
    for (const error of ['no_client', 'engine_stopped', 'stopped']) {
      const state = groupPlanState([{ connectionId: 'c1', run: planRun() }, { connectionId: 'c2', run: null, error }], DRAFT, true, false)
      expect(state.applicable).toBe(true)
      expect(state.clusters[1].blocking).toBe(false)
    }
  })

  it('blocks the apply on an internal or unknown start error, and says which cluster blocks', () => {
    for (const error of ['internal', 'something_new']) {
      const state = groupPlanState([{ connectionId: 'c1', run: planRun() }, { connectionId: 'c2', run: null, error }], DRAFT, true, false)
      expect(state.applicable).toBe(false)
      expect(state.clusters[1].blocking).toBe(true)
    }
  })

  it('blocks the apply when the plan of a cluster cannot be read any more, and stops waiting for it', () => {
    const state = groupPlanState([{ connectionId: 'c1', run: planRun() }, { connectionId: 'c2', run: null, fatal: true }], DRAFT, true, false)
    expect(state.running).toBe(false)
    expect(state.applicable).toBe(false)
    expect(state.clusters[1]).toMatchObject({ blocking: true, running: false })
  })
  // The text an unreachable cluster answers at the lab: its plan run ends failed, it does not refuse to start.
  const LAB_UNREACHABLE = 'read the guests: GET /cluster/resources?type=vm: request failed: all 3 cluster nodes unreachable (last error: Get "https://10.42.0.111:8006/api2/json/cluster/resources?type=vm": dial tcp 10.42.0.111:8006: connect: connection refused)'

  it('lets a cluster whose plan run failed to reach it catch up later, like a start error no_client', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: failedWith({ ...planRun(), result: null }, LAB_UNREACHABLE) },
    ], DRAFT, true, false)
    expect(state.applicable).toBe(true)
    expect(state.blockReason).toBeNull()
    expect(state.clusters[1]).toMatchObject({ unreachable: true, blocking: false, running: false })
  })

  it('still blocks the apply on any other failed plan, and says why', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: planRun() },
      { connectionId: 'c2', run: failedWith({ ...planRun(), result: null }, 'save the revision: duplicate key') },
    ], DRAFT, true, false)
    expect(state.applicable).toBe(false)
    expect(state.blockReason).toBe('failed')
    expect(state.clusters[1].unreachable).toBe(false)
  })

  it('blocks the apply on a failed plan whose error only mentions a refused connection outside the PVE client', () => {
    for (const error of ['500 proxy: connection refused', 'dial tcp 127.0.0.1:5432: connect: connection refused']) {
      const state = groupPlanState([
        { connectionId: 'c1', run: planRun() },
        { connectionId: 'c2', run: failedWith({ ...planRun(), result: null }, error) },
      ], DRAFT, true, false)
      expect(state.applicable, error).toBe(false)
      expect(state.clusters[1].unreachable, error).toBe(false)
      expect(state.blockReason, error).toBe('failed')
    }
  })

  it('has no usable plan when every cluster is unreachable, and says so', () => {
    const state = groupPlanState([
      { connectionId: 'c1', run: null, error: 'no_client' },
      { connectionId: 'c2', run: failedWith({ ...planRun(), result: null }, LAB_UNREACHABLE) },
    ], DRAFT, true, false)
    expect(state.applicable).toBe(false)
    expect(state.blockReason).toBe('noCluster')
  })

  it('names the reason Apply is refused: a start error, a stale plan, collisions; none while computing', () => {
    const reason = (second: Parameters<typeof groupPlanState>[0][number], conflict = false) =>
      groupPlanState([{ connectionId: 'c1', run: planRun() }, second], DRAFT, true, conflict).blockReason
    expect(reason({ connectionId: 'c2', run: null, error: 'internal' })).toBe('failed')
    expect(reason({ connectionId: 'c2', run: null, fatal: true })).toBe('failed')
    expect(reason({ connectionId: 'c2', run: planRun({ version: 2 }) })).toBe('stale')
    expect(reason({ connectionId: 'c2', run: planRun() }, true)).toBe('stale')
    expect(reason({ connectionId: 'c2', run: planRun({ collisions: ['pcz-web'] }) })).toBe('collisions')
    expect(reason({ connectionId: 'c2', run: planRun({}, 'running') })).toBeNull()
    expect(reason({ connectionId: 'c2', run: planRun() })).toBeNull()
  })
})
