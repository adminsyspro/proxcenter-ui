import { describe, expect, it } from 'vitest'

import { haOverall, isClusterConverted, nodeState, toHaInfo, type HaClusterAnswer } from './ha'

const ALL_RUNNING = { etcd: 'running', frontend: 'running', haproxy: 'running', keepalived: 'running', orchestrator: 'running', patroni: 'running', weasyprint: 'running' }
const ALL_STOPPED = Object.fromEntries(Object.keys(ALL_RUNNING).map(k => [k, 'stopped']))
const ALL_UNKNOWN = Object.fromEntries(Object.keys(ALL_RUNNING).map(k => [k, 'unknown']))

// Recorded on the lab cluster pxc-ha1..3 on 2026-11-17, node 1 stopped.
const LAB: HaClusterAnswer = {
  patroni: {
    syncMode: 'synchronous_mode_strict',
    paused: false,
    members: [
      { name: 'proxcenter-1', host: '10.42.0.41', state: 'unreachable', version: '' },
      { name: 'proxcenter-2', host: '10.42.0.42', role: 'leader', state: 'running', version: 'dev' },
      { name: 'proxcenter-3', host: '10.42.0.43', role: 'sync_standby', state: 'streaming', version: 'dev', lagBytes: 0 }
    ]
  },
  etcd: { members: [{ name: 'proxcenter-1', healthy: false }, { name: 'proxcenter-2', healthy: true }, { name: 'proxcenter-3', healthy: true }] },
  vip: { address: '10.42.0.40', holder: 'proxcenter-3' },
  services: { 'proxcenter-1': ALL_STOPPED, 'proxcenter-2': ALL_RUNNING, 'proxcenter-3': ALL_RUNNING },
  hosts: {
    'proxcenter-1': { load1: 0.04, load5: 0.04, load15: 0.01, cpus: 4, mem_total_bytes: 4104830976, mem_available_bytes: 3698987008 },
    'proxcenter-2': { load1: 0.85, load5: 0.62, load15: 0.25, cpus: 4, mem_total_bytes: 4104830976, mem_available_bytes: 3109507072 }
  }
}

describe('isClusterConverted', () => {
  it('holds for a deployed cluster and for one whose last deploy failed after a first conversion', () => {
    expect(isClusterConverted({ deploymentState: 'deployed' })).toBe(true)
    expect(isClusterConverted({ deploymentState: 'failed', deployedAt: '2026-11-06T10:00:00Z' })).toBe(true)
  })

  it('does not hold for a configuration that was never deployed', () => {
    expect(isClusterConverted({ deploymentState: 'idle', deployedAt: null })).toBe(false)
    expect(isClusterConverted({ deploymentState: 'deploying' })).toBe(false)
    expect(isClusterConverted({ deploymentState: 'failed', deployedAt: null })).toBe(false)
    expect(isClusterConverted(null)).toBe(false)
    expect(isClusterConverted(undefined)).toBe(false)
  })
})

describe('nodeState', () => {
  it('is up when every service runs', () => {
    expect(nodeState({ services: ALL_RUNNING, dbState: 'running' })).toBe('up')
  })

  it('is degraded when one service is not running, or the database does not answer', () => {
    expect(nodeState({ services: { ...ALL_RUNNING, weasyprint: 'stopped' }, dbState: 'running' })).toBe('degraded')
    expect(nodeState({ services: { ...ALL_RUNNING, etcd: 'unknown' }, dbState: 'running' })).toBe('degraded')
    expect(nodeState({ services: ALL_RUNNING, dbState: 'unreachable' })).toBe('degraded')
  })

  it('is down when nothing runs or nothing is known of it', () => {
    expect(nodeState({ services: ALL_STOPPED, dbState: 'unreachable' })).toBe('down')
    expect(nodeState({ services: ALL_UNKNOWN, dbState: null })).toBe('down')
    expect(nodeState({ services: {}, dbState: null })).toBe('down')
  })
})

describe('toHaInfo', () => {
  it('describes each node of the lab cluster', () => {
    const ha = toHaInfo(LAB)

    expect(ha).toMatchObject({ vip: '10.42.0.40', syncMode: 'synchronous_mode_strict', paused: false, hasLeader: true })
    expect(ha.nodes.map(n => [n.name, n.state, n.dbRole, n.holdsVip, n.etcdHealthy])).toEqual([
      ['proxcenter-1', 'down', null, false, false],
      ['proxcenter-2', 'up', 'leader', false, true],
      ['proxcenter-3', 'up', 'sync_standby', true, true]
    ])
    expect(ha.nodes[1]).toMatchObject({ address: '10.42.0.42', version: 'dev', lagBytes: 0 })
    expect(ha.nodes[0].version).toBeNull()
    expect(ha.nodes[1].host).toEqual({ load1: 0.85, load5: 0.62, load15: 0.25, cpus: 4, memTotalBytes: 4104830976, memAvailableBytes: 3109507072 })
    // A node whose reading failed has no host figures rather than zeros.
    expect(ha.nodes[2].host).toBeNull()
  })

  it('tolerates an orchestrator that predates the host reading, and an empty answer', () => {
    const ha = toHaInfo({ ...LAB, hosts: undefined })

    expect(ha.nodes.every(n => n.host === null)).toBe(true)
    expect(toHaInfo({})).toEqual({ vip: '', syncMode: '', paused: false, hasLeader: false, nodes: [] })
  })

  it('names no VIP holder when the orchestrator found none', () => {
    expect(toHaInfo({ ...LAB, vip: { address: '10.42.0.40', holder: '' } }).nodes.some(n => n.holdsVip)).toBe(false)
  })
})

describe('haOverall', () => {
  it('is degraded while a node is not fully up', () => {
    expect(haOverall(toHaInfo(LAB))).toBe('degraded')
  })

  it('is up when every node is', () => {
    const members = LAB.patroni!.members!.map(m => ({ ...m, role: m.role ?? 'replica', state: m.role ? m.state : 'streaming' }))
    const services = { 'proxcenter-1': ALL_RUNNING, 'proxcenter-2': ALL_RUNNING, 'proxcenter-3': ALL_RUNNING }

    expect(haOverall(toHaInfo({ ...LAB, services, patroni: { ...LAB.patroni, members } }))).toBe('up')
  })

  it('is down without a database primary', () => {
    const members = LAB.patroni!.members!.map(m => ({ ...m, role: m.role === 'leader' ? 'replica' : m.role }))

    expect(haOverall(toHaInfo({ ...LAB, patroni: { ...LAB.patroni, members } }))).toBe('down')
  })
})
