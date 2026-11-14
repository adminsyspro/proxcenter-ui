import { describe, expect, it } from 'vitest'

import { dashboardPhase, deniesInbound, todoItems } from './dashboardModel'

describe('deniesInbound', () => {
  it('takes DROP and REJECT for a deny, ACCEPT not', () => {
    expect(deniesInbound('DROP')).toBe(true)
    expect(deniesInbound('REJECT')).toBe(true)
    expect(deniesInbound('ACCEPT')).toBe(false)
  })
})

describe('todoItems', () => {
  const clean = { firewallOn: true, stopped: false, stopHoldsFirewall: false, policyIn: 'DROP', unprotected: 0, unzoned: 0, pendingFlows: { count: 0, more: false } }

  it('is empty when there is nothing to do', () => {
    expect(todoItems(clean)).toEqual([])
  })

  it('lists every line, most urgent first, with its figure', () => {
    expect(todoItems({ ...clean, policyIn: 'ACCEPT', unprotected: 29, unzoned: 13, pendingFlows: { count: 100, more: true } })).toEqual([
      { kind: 'policyIn' },
      { kind: 'unprotected', count: 29 },
      { kind: 'unzoned', count: 13 },
      { kind: 'pendingFlows', count: 100, more: true },
    ])
  })

  it('offers the deployment wizard for a firewall that is off, never during an emergency stop', () => {
    expect(todoItems({ ...clean, firewallOn: false })).toEqual([{ kind: 'firewallOff' }])
    expect(todoItems({ ...clean, firewallOn: false, stopped: true, stopHoldsFirewall: true })).toEqual([{ kind: 'stopHeld' }])
    expect(todoItems({ ...clean, firewallOn: false, stopped: true })).toEqual([])
  })

  it('asks nothing of an inbound REJECT policy', () => {
    expect(todoItems({ ...clean, policyIn: 'REJECT' })).toEqual([])
  })

  it('adds no line for what is not known', () => {
    expect(todoItems({ ...clean, unprotected: null, unzoned: null, pendingFlows: null })).toEqual([])
  })
})

describe('dashboardPhase', () => {
  const ready = { firewallLoading: false, loadError: false, coverageIn: true, coverageFailed: false, stopStateIn: true, microsegListsIn: true }

  it('shows everything once every read is in', () => {
    expect(dashboardPhase(ready)).toEqual({ cluster: 'ready', coverage: 'ready', todo: 'ready' })
  })

  it('keeps one skeleton per block while its reads are not in', () => {
    expect(dashboardPhase({ ...ready, firewallLoading: true })).toEqual({ cluster: 'loading', coverage: 'ready', todo: 'loading' })
    expect(dashboardPhase({ ...ready, coverageIn: false })).toEqual({ cluster: 'ready', coverage: 'loading', todo: 'loading' })
  })

  it('waits for the stop state and the micro-segmentation lists before the "To do" list', () => {
    expect(dashboardPhase({ ...ready, stopStateIn: false }).todo).toBe('loading')
    expect(dashboardPhase({ ...ready, microsegListsIn: false }).todo).toBe('loading')
  })

  it('lists nothing on a failed load, and still lists on a failed coverage', () => {
    expect(dashboardPhase({ ...ready, loadError: true })).toEqual({ cluster: 'unavailable', coverage: 'ready', todo: 'unavailable' })
    expect(dashboardPhase({ ...ready, coverageIn: false, coverageFailed: true })).toEqual({ cluster: 'ready', coverage: 'unavailable', todo: 'ready' })
  })
})
