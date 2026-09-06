import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import PlacementConstraintsCard, { type BalancingDomain, type PinnedGuest } from './PlacementConstraintsCard'

// Keys are echoed with their interpolation values so the tests can assert the
// counts and spreads actually reach the translation.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, unknown>) =>
    vals ? `${k} ${JSON.stringify(vals)}` : k
}))

afterEach(cleanup)

const pinned = (over: Partial<PinnedGuest> = {}): PinnedGuest => ({
  connection_id: 'dr',
  vmid: 9101,
  name: 't-dmz-a',
  node: 'pve1-dr',
  reason: 'network "vdmz" unavailable on node "pve2-dr": SDN zone "zdmz" is restricted to [pve1-dr]',
  ...over
})

const domain = (over: Partial<BalancingDomain> = {}): BalancingDomain => ({
  connection_id: 'dr',
  nodes: ['pve1-dr', 'pve2-dr'],
  guests: 1,
  spread: 3.8194,
  ...over
})

const names = { dr: 'PVE-DR', prod: 'PVE-PROD' }

describe('PlacementConstraintsCard', () => {
  it('renders nothing on a cluster with no placement restriction', () => {
    const { container } = render(
      <PlacementConstraintsCard pinnedGuests={[]} balancingDomains={[]} connectionNames={names} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when a cluster has a single, cluster-wide domain', () => {
    // One domain covering every node means nothing restricts placement, which
    // is the common case and must stay silent.
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={[domain({ connection_id: 'prod', nodes: ['pve1', 'pve2', 'pve3'] })]}
        connectionNames={names}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('lists the pinned guests with their node and the blocking reason', () => {
    render(
      <PlacementConstraintsCard
        pinnedGuests={[pinned(), pinned({ vmid: 9102, name: 't-dmz-b' })]}
        balancingDomains={[]}
        connectionNames={names}
      />
    )

    expect(screen.getByText('PVE-DR')).toBeInTheDocument()
    expect(screen.getByText('t-dmz-a (9101)')).toBeInTheDocument()
    expect(screen.getByText('t-dmz-b (9102)')).toBeInTheDocument()
    expect(screen.getAllByText(/drsPage.pinnedGuestOn.*pve1-dr/)).toHaveLength(2)
    expect(screen.getAllByText(/SDN zone "zdmz" is restricted/)).toHaveLength(2)
  })

  it('shows each multi-node domain with its guest count and spread', () => {
    render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={[
          domain(),
          domain({ nodes: ['pve1-dr', 'pve2-dr', 'pve3-dr'], guests: 2, spread: 7.0102 })
        ]}
        connectionNames={names}
      />
    )

    expect(screen.getByText(/drsPage.domainGuests.*"count":1/)).toBeInTheDocument()
    expect(screen.getByText(/drsPage.domainGuests.*"count":2/)).toBeInTheDocument()
    // One decimal, so an operator reads a spread rather than a float dump.
    expect(screen.getByText(/drsPage.domainSpread.*"value":"3.8"/)).toBeInTheDocument()
    expect(screen.getByText(/drsPage.domainSpread.*"value":"7.0"/)).toBeInTheDocument()
  })

  it('lists a single-node domain but shows no spread for it', () => {
    // The cluster chip counts every domain, so the card must list every domain
    // too: hiding the single-node ones made the tooltip say 4 while the card
    // showed 2. A one-node domain has no spread worth reading, it has no target.
    render(
      <PlacementConstraintsCard
        pinnedGuests={[pinned()]}
        balancingDomains={[domain({ nodes: ['pve1-dr'], guests: 2, spread: 0 }), domain()]}
        connectionNames={names}
      />
    )

    expect(screen.queryByText(/"value":"0.0"/)).not.toBeInTheDocument()
    expect(screen.getByText(/"value":"3.8"/)).toBeInTheDocument()
    expect(screen.getByText('drsPage.domainNoTarget')).toBeInTheDocument()
    expect(screen.getAllByText('pve1-dr')).toHaveLength(2)
  })

  it('groups by cluster and falls back to a short id when the name is unknown', () => {
    render(
      <PlacementConstraintsCard
        pinnedGuests={[pinned(), pinned({ connection_id: 'cmtk6hu1r00007zjlo0kto72x', vmid: 42, name: 'x' })]}
        balancingDomains={[]}
        connectionNames={names}
      />
    )

    expect(screen.getByText('PVE-DR')).toBeInTheDocument()
    expect(screen.getByText('cmtk6hu1r000')).toBeInTheDocument()
  })

  it('renders a cluster that only has pinned guests, with no domain block', () => {
    render(
      <PlacementConstraintsCard pinnedGuests={[pinned()]} balancingDomains={[]} connectionNames={names} />
    )

    expect(screen.getByText('drsPage.pinnedGuestsTitle')).toBeInTheDocument()
    expect(screen.queryByText('drsPage.balancingDomainsTitle')).not.toBeInTheDocument()
  })
})
