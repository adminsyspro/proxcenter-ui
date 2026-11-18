/**
 * UA58: the pending bar says not applied yet, part by part, and goes on in lower case after the Firewalling prefix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegPolicy } from '@/lib/microseg/types'

vi.mock('@/lib/microseg/useLastRevision', () => ({ useLastRevisionSnapshot: () => ({ revision: null, loading: false }) }))

import PendingChangesBar, { diffParts } from './PendingChangesBar'
import { NO_DIFF } from './usePendingChanges'
import { RunsInProgressProvider } from './runsInProgress'

afterEach(cleanup)

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${values.count}` : key)

describe('diffParts', () => {
  it('lists the zones then the flows added, changed, removed, then the member changes and the tag prefix', () => {
    const diff: PolicyDiff = {
      ...NO_DIFF,
      zones: new Map([['z1', 'changed'], ['z2', 'added'], ['z3', 'changed']]),
      flows: new Map([['f1', 'removed'], ['f2', 'added']]),
      members: 3,
      prefix: true,
    }
    expect(diffParts(diff, t)).toEqual([
      'microsegPilot.pending.zones.added:1',
      'microsegPilot.pending.zones.changed:2',
      'microsegPilot.pending.flows.added:1',
      'microsegPilot.pending.flows.removed:1',
      'microsegPilot.pending.members:3',
      'microsegPilot.pending.tagPrefix',
    ])
  })

  it('names the few things that change when it is given the draft, and counts the many', () => {
    const tt = (key: string, values?: Record<string, string | number>) => `${key.replace('microsegPilot.pending.', '')}(${Object.values(values ?? {}).join('|')})`
    const zone = (id: string, name: string) => ({ id, name }) as MicrosegPolicy['zones'][number]
    const flowOf = (id: string, src: string, dst: string, dport: string, cidr = '') => ({ id, src_zone_id: src, dst_zone_id: dst, src_cidr: '', dst_cidr: cidr, proto: 'tcp', dport }) as MicrosegPolicy['flows'][number]
    const member = (vmid: number, zone_id: string) => ({ id: `m${vmid}`, policy_id: 'p1', node: 'pve1', type: 'qemu', vmid, zone_id }) as MicrosegPolicy['pending_members'][number]
    const draft = {
      zones: [zone('z1', 'web'), zone('z2', 'db'), zone('z3', 'app'), zone('z4', 'cache'), zone('z5', 'mon')],
      flows: [flowOf('f1', 'z1', 'z2', '5432'), flowOf('f2', 'z1', '', '443', '203.0.113.0/24'), flowOf('f3', 'z2', 'z1', '22')],
      pending_members: [member(100, 'z1'), member(101, 'z1'), member(102, 'z2')],
    }
    const diff: PolicyDiff = {
      ...NO_DIFF,
      zones: new Map([['z1', 'changed'], ['z3', 'added'], ['z4', 'added'], ['z5', 'added']]),
      flows: new Map([['f1', 'added'], ['f2', 'changed'], ['f3', 'changed']]),
      removedZones: [zone('z9', 'old')],
      members: 3,
    }
    expect(diffParts(diff, tt, draft)).toEqual([
      // Three zones added: counted. One changed, one removed: named.
      'zones.added(3)', 'zonesNamed.changed(1|web)',
      // One flow added: named, a zone or a network at each end. Two changed: counted.
      'flowsNamed.added(web → db PostgreSQL)', 'flows.changed(2)',
      // The guests queued, per zone.
      'membersTo(2|web)', 'membersTo(1|db)',
    ])
    // Guests queued for more zones than are named, or for a zone the draft does not hold: counted.
    expect(diffParts({ ...NO_DIFF, members: 3 }, tt, { ...draft, pending_members: [member(1, 'z1'), member(2, 'z2'), member(3, 'z3')] })).toEqual(['members(3)'])
    expect(diffParts({ ...NO_DIFF, members: 1 }, tt, { ...draft, pending_members: [member(1, 'gone')] })).toEqual(['members(1)'])
  })

  it('counts the exceptions added, changed, removed after the flows', () => {
    const diff: PolicyDiff = {
      ...NO_DIFF,
      flows: new Map([['f1', 'added']]),
      exceptions: new Map([['e1', 'added'], ['e2', 'added'], ['e3', 'changed'], ['e4', 'removed']]),
      members: 1,
    }
    expect(diffParts(diff, t)).toEqual([
      'microsegPilot.pending.flows.added:1',
      'microsegPilot.pending.exceptions.added:2',
      'microsegPilot.pending.exceptions.changed:1',
      'microsegPilot.pending.exceptions.removed:1',
      'microsegPilot.pending.members:1',
    ])
  })

  it('says nothing for an empty diff', () => {
    expect(diffParts(NO_DIFF, t)).toEqual([])
  })
})

describe('pending bar text', () => {
  const policy = {
    policy: { id: 'p1', tag_prefix: 'pc-', settings: {} },
    version: 7,
    zones: [{ id: 'z1', name: 'db' }],
    flows: [],
    pending_members: [{ id: 'm1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 100, zone_id: 'z1' }],
    pending_changes: true,
    last_revision: null,
  } as unknown as MicrosegPolicy

  it('says that nothing changes in Proxmox until the plan is applied, and makes the plan the main button', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={policy} onOpenPlan={() => {}} />)
    expect(screen.getByTestId('pending-until-applied').textContent).toBe('Nothing changes in Proxmox until you apply the plan.')
    expect(screen.getByRole('button', { name: 'Review and apply' }).className).toContain('MuiButton-contained')
  })

  it('starts with a capital on its own', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={policy} />)
    expect(screen.getByText('Not applied yet: zone db added, 1 guest to db.')).toBeTruthy()
  })

  it('goes on in lower case after a prefix', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={policy} prefix='Micro-segmentation' />)
    expect(screen.getByText('Micro-segmentation: not applied yet: zone db added, 1 guest to db.')).toBeTruthy()
  })

  it('says the exceptions the draft adds', () => {
    const exception = { id: 'e1', policy_id: 'p1', zone_id: 'z1', sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }], destinations: [{ type: 'qemu', vmid: 100, name: 'db-01' }], services: [{ proto: 'tcp', dport: '5432' }], comment: '', created_by: 'me' }
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={{ ...policy, exceptions: [exception] } as MicrosegPolicy} />)
    expect(screen.getByText('Not applied yet: zone db added, 1 exception added, 1 guest to db.')).toBeTruthy()
  })

  const link = (connection_id: string, active: boolean) => ({ connection_id, active, stop_cluster_disabled: false, policy_id: 'p1', created_at: '2026-11-01T10:00:00Z', activated_at: null })
  const joining = { ...policy, clusters: [link('c1', true), link('c2', false)] } as MicrosegPolicy

  it('counts a cluster associated and not applied yet as a pending change, by its name', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={joining} clusterName={id => (id === 'c2' ? 'PVE-DR' : 'PVE-PROD')} />)
    expect(screen.getByText('Not applied yet: zone db added, 1 guest to db, cluster PVE-DR will be added.')).toBeTruthy()
  })

  it('counts the clusters to add without naming one the user cannot see', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={joining} clusterName={id => id} />)
    expect(screen.getByText('Not applied yet: zone db added, 1 guest to db, 1 cluster will be added.')).toBeTruthy()
  })

  const applying = { applying: true, zones: new Set<string>() }

  it('says the changes are being applied while a run writes them, with nothing to click', () => {
    renderWithProviders(<RunsInProgressProvider value={applying}><PendingChangesBar connectionId='c1' policy={policy} onOpenPlan={() => undefined} /></RunsInProgressProvider>)
    expect(screen.getByText('Being applied: zone db added, 1 guest to db')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says it in lower case after a prefix', () => {
    renderWithProviders(<RunsInProgressProvider value={applying}><PendingChangesBar connectionId='c1' policy={policy} prefix='Micro-segmentation' /></RunsInProgressProvider>)
    expect(screen.getByText('Micro-segmentation: being applied: zone db added, 1 guest to db')).toBeTruthy()
  })
})
