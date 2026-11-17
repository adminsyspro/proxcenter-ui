import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { HaInfo, HaNode } from '@/lib/platform/types'

import HaNodesSection from './HaNodesSection'

const GIB = 2 ** 30
const RUNNING = { etcd: 'running', frontend: 'running', haproxy: 'running', keepalived: 'running', orchestrator: 'running', patroni: 'running', weasyprint: 'running' }

const node = (over: Partial<HaNode>): HaNode => ({
  name: 'proxcenter-2',
  address: '10.42.0.42',
  state: 'up',
  dbRole: 'leader',
  dbState: 'running',
  lagBytes: 0,
  version: '1.5.0',
  holdsVip: false,
  etcdHealthy: true,
  services: RUNNING,
  host: { load1: 0.85, load5: 0.62, load15: 0.25, cpus: 4, memTotalBytes: 4 * GIB, memAvailableBytes: 3 * GIB },
  ...over
})

const ha = (over: Partial<HaInfo> = {}): HaInfo => ({
  vip: '10.42.0.40',
  syncMode: 'synchronous_mode_strict',
  paused: false,
  hasLeader: true,
  nodes: [
    node({ name: 'proxcenter-1', address: '10.42.0.41', state: 'down', dbRole: null, dbState: 'unreachable', version: null, services: Object.fromEntries(Object.keys(RUNNING).map(k => [k, 'stopped'])) }),
    node({}),
    node({ name: 'proxcenter-3', address: '10.42.0.43', dbRole: 'sync_standby', holdsVip: true, services: { ...RUNNING, weasyprint: 'surprising' }, host: null })
  ],
  ...over
})

const rowOf = (name: string) => screen.getByText(name).parentElement!.parentElement!

afterEach(() => {
  cleanup()
})

describe('HaNodesSection', () => {
  it('lists each node with its database role, its load and its memory on one line', () => {
    renderWithProviders(<HaNodesSection ha={ha()} />)

    expect(screen.getByText('Cluster nodes')).toBeInTheDocument()
    expect(screen.getByText('Virtual IP 10.42.0.40')).toBeInTheDocument()

    const primary = within(rowOf('proxcenter-2'))

    expect(primary.getByText('10.42.0.42')).toBeInTheDocument()
    expect(primary.getByText('DB Primary')).toBeInTheDocument()
    expect(primary.getByText('1.5.0')).toBeInTheDocument()
    expect(primary.getByText('0.85 / 4 cores')).toBeInTheDocument()
    expect(primary.getByText('1 GiB (25 %)')).toBeInTheDocument()
    expect(primary.getByRole('img', { name: 'Running' })).toBeInTheDocument()
    expect(primary.queryByText('VIP')).not.toBeInTheDocument()
  })

  it('marks the node holding the virtual IP and shows a dash where a node says nothing', () => {
    renderWithProviders(<HaNodesSection ha={ha()} />)

    const standby = within(rowOf('proxcenter-3'))

    expect(standby.getByText('DB Sync Standby')).toBeInTheDocument()
    expect(standby.getByText('VIP')).toBeInTheDocument()
    // No host reading: load and memory are dashes, not zeros.
    expect(standby.getAllByText('-')).toHaveLength(2)
  })

  it('shows a stopped node as down, its database unreachable and every service stopped', () => {
    renderWithProviders(<HaNodesSection ha={ha()} />)

    const down = within(rowOf('proxcenter-1'))

    expect(down.getByText('Unreachable')).toBeInTheDocument()
    expect(down.getByRole('img', { name: 'Down' })).toBeInTheDocument()
    for (const service of Object.keys(RUNNING)) {
      expect(down.getByRole('img', { name: `${service}: Stopped` })).toBeInTheDocument()
    }
  })

  it('names every service in the header and reads an unexpected state as unknown', () => {
    renderWithProviders(<HaNodesSection ha={ha()} />)

    for (const service of Object.keys(RUNNING)) expect(screen.getByText(service)).toBeInTheDocument()
    expect(within(rowOf('proxcenter-3')).getByRole('img', { name: 'weasyprint: Unknown' })).toBeInTheDocument()
    expect(within(rowOf('proxcenter-3')).getByRole('img', { name: 'etcd: Running' })).toBeInTheDocument()
  })

  it('flags a paused failover and a cluster without a primary', () => {
    renderWithProviders(<HaNodesSection ha={ha({ paused: true, hasLeader: false, vip: '' })} />)

    expect(screen.getByText('Automatic failover paused')).toBeInTheDocument()
    expect(screen.getByText('No database primary')).toBeInTheDocument()
    expect(screen.queryByText(/Virtual IP/)).not.toBeInTheDocument()
  })
})
