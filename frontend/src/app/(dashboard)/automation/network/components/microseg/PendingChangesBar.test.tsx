/**
 * UA58: the pending bar says what will change, part by part, and goes on in lower case after the Firewalling prefix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegPolicy } from '@/lib/microseg/types'

vi.mock('@/lib/microseg/useLastRevision', () => ({ useLastRevisionSnapshot: () => ({ revision: null, loading: false }) }))

import PendingChangesBar, { diffParts } from './PendingChangesBar'
import { NO_DIFF } from './usePendingChanges'

afterEach(cleanup)

const t = (key: string, values?: Record<string, number>) => (values ? `${key}:${values.count}` : key)

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

  it('starts with a capital on its own', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={policy} />)
    expect(screen.getByText('What will change: 1 zone added, 1 member change')).toBeTruthy()
  })

  it('goes on in lower case after a prefix', () => {
    renderWithProviders(<PendingChangesBar connectionId='c1' policy={policy} prefix='Micro-segmentation' />)
    expect(screen.getByText('Micro-segmentation: what will change: 1 zone added, 1 member change')).toBeTruthy()
  })
})
