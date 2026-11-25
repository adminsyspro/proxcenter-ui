import { describe, expect, it } from 'vitest'

import { advancedChanged, changesNodes, forwarderBlocker, invalidFields, nodeStateKey, nodeStatus, settingsOf, type LogCollectionState } from './types'

const limits = { min_queue_mb: 16, max_queue_mb: 4096, min_budget: 1000, max_budget: 300000 }

const state = (over: Partial<LogCollectionState> = {}): LogCollectionState => ({
  mode: 'api', receiver_host: '', receiver_port: 6344, queue_mb: 256, budget_lines_per_min: 30000,
  receiver_default: '10.42.0.40', ssh_enabled: true, has_policy: true, limits, nodes: [], run: null, busy: false, ...over,
})

describe('log collection settings', () => {
  it('proposes the receiver address the orchestrator suggests until one is saved', () => {
    expect(settingsOf(state()).receiver_host).toBe('10.42.0.40')
    expect(settingsOf(state({ receiver_host: 'logs.example.org' })).receiver_host).toBe('logs.example.org')
    expect(settingsOf(state({ receiver_port: 0 })).receiver_port).toBe(6344)
  })

  it('says why the forwarder mode cannot be chosen', () => {
    expect(forwarderBlocker({ ssh_enabled: true, has_policy: true })).toBeNull()
    expect(forwarderBlocker({ ssh_enabled: false, has_policy: true })).toBe('ssh')
    expect(forwarderBlocker({ ssh_enabled: true, has_policy: false })).toBe('policy')
    expect(forwarderBlocker({ ssh_enabled: false, has_policy: false })).toBe('ssh')
  })

  it('validates each field by its type, and nothing in API mode', () => {
    const good = { mode: 'forwarder' as const, receiver_host: '10.42.0.40', receiver_port: 6344, queue_mb: 256, budget_lines_per_min: 30000 }

    expect(invalidFields(good, limits)).toEqual([])
    expect(invalidFields({ ...good, receiver_host: '2001:db8::7' }, limits)).toEqual([])
    expect(invalidFields({ ...good, receiver_host: 'a;reboot' }, limits)).toEqual(['receiver_host'])
    expect(invalidFields({ ...good, receiver_host: '-oProxyCommand=x' }, limits)).toEqual(['receiver_host'])
    expect(invalidFields({ ...good, receiver_host: '' }, limits)).toEqual(['receiver_host'])
    expect(invalidFields({ ...good, receiver_port: 70000 }, limits)).toEqual(['receiver_port'])
    expect(invalidFields({ ...good, queue_mb: 8 }, limits)).toEqual(['queue_mb'])
    expect(invalidFields({ ...good, budget_lines_per_min: 400000 }, limits)).toEqual(['budget_lines_per_min'])
    expect(invalidFields({ ...good, queue_mb: 12.5 }, limits)).toEqual(['queue_mb'])
    expect(invalidFields({ ...good, mode: 'api', receiver_host: '' }, limits)).toEqual([])
  })

  it('tells a change that reaches the nodes from one that only moves the budget', () => {
    const fwd = state({ mode: 'forwarder', receiver_host: '10.42.0.40' })
    const same = settingsOf(fwd)

    expect(changesNodes(state(), { ...same, mode: 'forwarder' })).toBe(true)
    expect(changesNodes(fwd, { ...same, mode: 'api' })).toBe(true)
    expect(changesNodes(fwd, same)).toBe(false)
    expect(changesNodes(fwd, { ...same, budget_lines_per_min: 50000 })).toBe(false)
    expect(changesNodes(fwd, { ...same, queue_mb: 512 })).toBe(true)
    expect(changesNodes(fwd, { ...same, receiver_port: 6400 })).toBe(true)
    expect(changesNodes(state(), settingsOf(state()))).toBe(false)
  })

  it('gives each node its dot and its state label', () => {
    expect(nodeStatus({ node: 'a', state: 'installed' })).toBe('online')
    expect(nodeStatus({ node: 'a', state: 'installed', silent: true })).toBe('offline')
    expect(nodeStatus({ node: 'a', state: 'installed', drift: 'binary' })).toBe('maintenance')
    expect(nodeStatus({ node: 'a', state: 'installed', paused: true })).toBe('maintenance')
    expect(nodeStatus({ node: 'a', state: 'failed' })).toBe('offline')
    expect(nodeStatus({ node: 'a', state: 'missing' })).toBe('offline')
    expect(nodeStatus({ node: 'a', state: 'installing' })).toBeUndefined()

    expect(nodeStateKey({ node: 'a', state: 'installed' })).toBe('installed')
    expect(nodeStateKey({ node: 'a', state: 'installed', silent: true, drift: 'binary' })).toBe('silent')
    expect(nodeStateKey({ node: 'a', state: 'installed', drift: 'binary' })).toBe('drifted')
    expect(nodeStateKey({ node: 'a', state: 'installed', paused: true })).toBe('paused')
    expect(nodeStateKey({ node: 'a', state: 'failed' })).toBe('failed')
    expect(nodeStateKey({ node: 'a' })).toBe('missing')
  })

  it('says it is the removal that failed on a cluster back to the API read', () => {
    expect(nodeStateKey({ node: 'a', state: 'failed' }, 'api')).toBe('removeFailed')
    expect(nodeStateKey({ node: 'a', state: 'failed' }, 'forwarder')).toBe('failed')
  })
})

describe('advanced settings', () => {
  it('are left folded while the receiver, the queue and the budget keep their defaults', () => {
    expect(advancedChanged(state())).toBe(false)
    expect(advancedChanged(state({ receiver_host: '10.42.0.40' }))).toBe(false)
  })

  it.each([
    ['another receiver', { receiver_host: 'logs.example.org' }],
    ['another port', { receiver_port: 7000 }],
    ['another queue', { queue_mb: 512 }],
    ['another budget', { budget_lines_per_min: 60000 }],
  ])('are shown with %s', (_name, over) => {
    expect(advancedChanged(state(over as Partial<LogCollectionState>))).toBe(true)
  })
})
