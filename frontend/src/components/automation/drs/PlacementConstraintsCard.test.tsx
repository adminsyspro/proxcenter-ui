import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import PlacementConstraintsCard, {
  type BalancingDomain,
  type ExcludedGuest,
  type PinnedGuest,
  type RestrictedGuest
} from './PlacementConstraintsCard'

// Keys are echoed with their interpolation values so the tests can assert the
// counts, spreads and resource names actually reach the translation.
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, unknown>) =>
    vals ? `${k} ${JSON.stringify(vals)}` : k
}))

afterEach(cleanup)

// The row of a guest, by its VMID: every guest row carries it.
const rowOf = (container: HTMLElement, vmid: number) => container.querySelector(`[data-vmid="${vmid}"]`) as HTMLElement

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

const restricted = (over: Partial<RestrictedGuest> = {}): RestrictedGuest => ({
  connection_id: 'dr',
  vmid: 9501,
  name: 't-stor-a',
  type: 'qemu',
  node: 'pve1-dr',
  nodes: ['pve1-dr', 'pve2-dr'],
  limits: [{ kind: 'storage', resource: 'CephPoolDR', nodes: ['pve1-dr', 'pve2-dr'] }],
  ...over
})

const excluded = (over: Partial<ExcludedGuest> = {}): ExcludedGuest => ({
  connection_id: 'dr',
  vmid: 9190,
  name: 'r19-excl',
  type: 'qemu',
  node: 'pve1-dr',
  reason: 'tag',
  detail: 'pxc_ignore',
  ...over
})

const names = { dr: 'PVE-DR', prod: 'PVE-PROD' }

// The issue's cluster: every node for the free guests, two nodes for one
// storage-bound guest, one node for a zone-bound guest.
const issueDomains = [
  domain({ nodes: ['pve1-dr', 'pve2-dr', 'pve3-dr'], guests: 6, spread: 40.28 }),
  domain({ nodes: ['pve1-dr', 'pve2-dr'], guests: 1, spread: 4.1, constraints: ['storage'] }),
  domain({ nodes: ['pve2-dr'], guests: 1, spread: 0, constraints: ['network'] })
]

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

  it('stays silent when the only exclusions are local disks or guest type', () => {
    // Nearly every cluster has a guest on local-lvm: that alone must not put
    // the card on the page.
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={[domain({ connection_id: 'prod', nodes: ['pve1', 'pve2', 'pve3'] })]}
        excludedGuests={[
          excluded({ connection_id: 'prod', reason: 'local_disks', detail: 'local-lvm' }),
          excluded({ connection_id: 'prod', vmid: 9912, reason: 'guest_type', detail: 'lxc' })
        ]}
        connectionNames={names}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('names the guest that still has two nodes and the storage limiting it, under its domain', () => {
    // The issue: 32 free guests and one restricted to two nodes. The old card
    // showed "1 guest" on a node row and named nobody.
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={issueDomains}
        restrictedGuests={[restricted()]}
        connectionNames={names}
      />
    )

    const row = rowOf(container, 9501)

    expect(within(row).getByText('t-stor-a')).toBeInTheDocument()
    expect(within(row).getByText('#9501')).toBeInTheDocument()
    // Its own node, then the other node it can run on, each with the Proxmox logo.
    expect(within(row).getByText('pve1-dr')).toBeInTheDocument()
    expect(within(row).getByText('pve2-dr')).toBeInTheDocument()
    expect(row.querySelectorAll('img[src*="proxmox-logo"]')).toHaveLength(2)
    expect(within(row).getByText(/drsPage.limitStorageShort.*"resource":"CephPoolDR"/)).toBeInTheDocument()
    // Where the storage exists is not on the line: the tooltip carries it.
    expect(
      within(row).getByLabelText(/drsPage.limitStorage .*"resource":"CephPoolDR".*"nodes":"pve1-dr, pve2-dr"/)
    ).toBeInTheDocument()
    // The cluster-wide domain is labelled as the free one.
    expect(screen.getByText('drsPage.domainWholeCluster')).toBeInTheDocument()
    expect(screen.getByText(/drsPage.domainGuests.*"count":6/)).toBeInTheDocument()
  })

  it('names the VNet and its zone for a zone-bound guest, in the warning tone', () => {
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={issueDomains}
        restrictedGuests={[
          restricted({
            vmid: 9201,
            name: 't-users-a',
            node: 'pve2-dr',
            nodes: ['pve2-dr'],
            limits: [{ kind: 'network', resource: 'vusers', zone: 'zusers', nodes: ['pve2-dr'] }]
          })
        ]}
        connectionNames={names}
      />
    )

    const row = rowOf(container, 9201)

    expect(within(row).getByText('t-users-a')).toBeInTheDocument()
    expect(within(row).getByText(/drsPage.limitVnetShort.*"resource":"vusers".*"zone":"zusers"/)).toBeInTheDocument()
    expect(
      within(row).getByLabelText(/drsPage.limitVnet .*"resource":"vusers".*"zone":"zusers".*"nodes":"pve2-dr"/)
    ).toBeInTheDocument()
    // One on the domain row, one on the guest row: both say there is no target.
    expect(screen.getAllByText('drsPage.domainNoTarget')).toHaveLength(2)
    expect(within(row).getByText('drsPage.domainNoTarget')).toBeInTheDocument()
  })

  it('renders a plain-bridge limit without a zone', () => {
    render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={[]}
        restrictedGuests={[
          restricted({ nodes: ['pve1-dr', 'pve3-dr'], limits: [{ kind: 'network', resource: 'vmbr9', nodes: ['pve1-dr', 'pve3-dr'] }] })
        ]}
        connectionNames={names}
      />
    )

    expect(screen.getByText(/drsPage.limitBridgeShort.*"resource":"vmbr9"/)).toBeInTheDocument()
    expect(screen.getByLabelText(/drsPage.limitBridge .*"resource":"vmbr9".*"nodes":"pve1-dr, pve3-dr"/)).toBeInTheDocument()
    // No domain list came with it: the guest is still shown under its own title.
    expect(screen.getByText('drsPage.restrictedGuestsTitle')).toBeInTheDocument()
  })

  it('keeps a neutral border when every restricted guest still has somewhere to go', () => {
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={issueDomains.slice(0, 2)}
        restrictedGuests={[restricted()]}
        connectionNames={names}
      />
    )

    const card = container.querySelector('.MuiCard-root') as HTMLElement

    expect(card).not.toBeNull()
    // MUI resolves the palette key to a color; the warning orange must be absent.
    expect(getComputedStyle(card).borderColor).not.toMatch(/217, 119, 6|ff9800|ed6c02/i)
    expect(screen.queryByText('drsPage.domainNoTarget')).not.toBeInTheDocument()
  })

  it('lists an explicitly excluded guest as intentional, not as a restriction', () => {
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={[domain({ nodes: ['pve1-dr', 'pve2-dr', 'pve3-dr'], guests: 7 })]}
        excludedGuests={[
          excluded(),
          excluded({ vmid: 9231, name: 'ha-airgap-231', reason: 'local_disks', detail: 'ZFS-Pool' }),
          excluded({ vmid: 9912, name: 't901-dr', type: 'lxc', reason: 'guest_type', detail: 'lxc' })
        ]}
        connectionNames={names}
      />
    )

    // The tag exclusion is what lists the cluster; the other two ride along.
    expect(screen.getByText('drsPage.excludedGuestsTitle')).toBeInTheDocument()
    expect(within(rowOf(container, 9190)).getByText('r19-excl')).toBeInTheDocument()
    expect(screen.getByText(/drsPage.excludedTagShort.*"tag":"pxc_ignore"/)).toBeInTheDocument()
    expect(screen.getByLabelText(/drsPage.excludedByTag.*"tag":"pxc_ignore"/)).toBeInTheDocument()
    expect(screen.getByText(/drsPage.excludedLocalDisksShort.*"storages":"ZFS-Pool"/)).toBeInTheDocument()
    expect(screen.getByLabelText(/drsPage.excludedLocalDisks .*"storages":"ZFS-Pool"/)).toBeInTheDocument()
    expect(screen.getByText('drsPage.excludedGuestTypeShort')).toBeInTheDocument()
    expect(screen.getByLabelText('drsPage.excludedGuestType')).toBeInTheDocument()
    // An intentional exclusion never takes the warning tone.
    expect(screen.queryByText('drsPage.domainNoTarget')).not.toBeInTheDocument()
    expect(screen.queryByText('drsPage.restrictedGuestsTitle')).not.toBeInTheDocument()
  })

  it('falls back to the pinned list when the orchestrator sends no per-guest report', () => {
    render(
      <PlacementConstraintsCard
        pinnedGuests={[pinned(), pinned({ vmid: 9102, name: 't-dmz-b' })]}
        balancingDomains={[]}
        connectionNames={names}
      />
    )

    expect(screen.getByText('PVE-DR')).toBeInTheDocument()
    expect(screen.getByText('drsPage.pinnedGuestsTitle')).toBeInTheDocument()
    expect(screen.getByText('t-dmz-a')).toBeInTheDocument()
    expect(screen.getByText('t-dmz-b')).toBeInTheDocument()
    expect(screen.getAllByText(/SDN zone "zdmz" is restricted/)).toHaveLength(2)
  })

  it('does not list a pinned guest twice when the per-guest report also carries it', () => {
    render(
      <PlacementConstraintsCard
        pinnedGuests={[pinned({ vmid: 9201, name: 't-users-a', node: 'pve2-dr' })]}
        balancingDomains={issueDomains}
        restrictedGuests={[
          restricted({ vmid: 9201, name: 't-users-a', node: 'pve2-dr', nodes: ['pve2-dr'], limits: [] })
        ]}
        connectionNames={names}
      />
    )

    expect(screen.getAllByText('t-users-a')).toHaveLength(1)
    expect(screen.queryByText('drsPage.pinnedGuestsTitle')).not.toBeInTheDocument()
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
    expect(screen.getByText(/drsPage.spreadPts.*"value":"3.8"/)).toBeInTheDocument()
    expect(screen.getByText(/drsPage.spreadPts.*"value":"7.0"/)).toBeInTheDocument()
  })

  it('lists a single-node domain but shows no spread for it', () => {
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
    // Two domain rows and the pinned guest's own node.
    expect(screen.getAllByText('pve1-dr')).toHaveLength(3)
  })

  it('shows the live status of each guest and node on its glyph', () => {
    const { container } = render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={issueDomains.slice(0, 2)}
        restrictedGuests={[restricted()]}
        connectionNames={names}
        vmStatus={{ 'dr:9501': 'running' }}
        nodeStatus={{ 'dr:pve1-dr': 'online', 'dr:pve2-dr': 'maintenance' }}
      />
    )

    const row = rowOf(container, 9501)
    const dots = [...row.querySelectorAll('span, div')].map(el => getComputedStyle(el).backgroundColor)

    // running guest green, online node green, node in maintenance orange.
    expect(dots).toContain('rgb(76, 175, 80)')
    expect(dots).toContain('rgb(255, 152, 0)')
  })

  it('pages a long list past 20 guests', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      excluded({ vmid: 9300 + i, name: `g-${i}`, reason: i === 0 ? 'tag' : 'local_disks', detail: 'ZFS-Pool' })
    )

    render(
      <PlacementConstraintsCard
        pinnedGuests={[]}
        balancingDomains={[domain({ nodes: ['pve1-dr', 'pve2-dr', 'pve3-dr'], guests: 25 })]}
        excludedGuests={many}
        connectionNames={names}
      />
    )

    expect(screen.getByText('g-0')).toBeInTheDocument()
    expect(screen.queryByText('g-24')).not.toBeInTheDocument()
    expect(screen.getByText('common.rowsPerPage')).toBeInTheDocument()
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
})
