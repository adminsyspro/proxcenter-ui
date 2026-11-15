/**
 * The nodes of the node view on their own: the circle of a Proxmox node (name, guest count, a dot per zone, the
 * flows that stay inside), a guest in the colour of its zone and the "+N" of a node.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

vi.mock('@xyflow/react', async () => (await import('./xyflowTestMock')).xyflowMock)

import { member } from './mapViewsTestKit'
import { MAX_ZONE_DOTS, PveNode } from './PveNode'
import { GuestNode, MoreNode } from './ZoneNode'
import type { GuestNodeData, MoreNodeData, PveNodeData } from './zoneGraph'

const props = <T,>(data: T) => ({ id: 'n1', data }) as unknown as Parameters<typeof PveNode>[0]
const pve = (over: Partial<PveNodeData> = {}): PveNodeData => ({
  kind: 'pveNode', node: 'pve1', count: 3, zones: [{ id: 'zw', name: 'web', color: '#ff5722', count: 2 }], unzoned: 1, inside: 0, insideByKind: { unprotected: 0, blocked: 0 }, radius: 110, ...over,
})

afterEach(cleanup)

describe('the circle of a Proxmox node', () => {
  it('names the node, counts its guests and draws a dot per zone, grey for the guests in no zone', () => {
    renderWithProviders(<PveNode {...props(pve())} />)
    expect(screen.getByRole('group', { name: 'Proxmox node pve1, 3 guests' })).toBeTruthy()
    expect(screen.getByText('pve1')).toBeTruthy()
    expect(screen.getByText('3 guests')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Zone web: 2 guests' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'No zone: 1 guest' })).toBeTruthy()
    expect(screen.queryByText(/internal flow/)).toBeNull()
  })

  it('shows the Proxmox logo of a node as the rest of the app does, with its status, and no generic server glyph', () => {
    const { container } = renderWithProviders(<PveNode {...props(pve({ status: 'online' }))} />)
    expect(container.querySelector('img[src="/images/proxmox-logo.svg"]')).toBeTruthy()
    expect(container.querySelector('.ri-server-line')).toBeNull()
    expect(screen.getByTestId('pve-icon').getAttribute('data-status')).toBe('online')
    // The status dot of the app's node icon.
    expect(screen.getByTestId('pve-icon').querySelectorAll('span span, span div').length).toBeGreaterThan(0)
  })

  it('shows the logo alone, without a status dot, when the status of the node is not known', () => {
    const { container } = renderWithProviders(<PveNode {...props(pve())} />)
    expect(container.querySelector('img[src="/images/proxmox-logo.svg"]')).toBeTruthy()
    expect(screen.getByTestId('pve-icon').getAttribute('data-status')).toBe('unknown')
    expect(screen.getByTestId('pve-icon').children).toHaveLength(1)
  })

  it('counts the observed flows that stay inside it', () => {
    renderWithProviders(<PveNode {...props(pve({ inside: 2 }))} />)
    expect(screen.getByText('2 internal flows')).toBeTruthy()
  })

  it('stands for the zones past the dots it draws with a "+N"', () => {
    const zones = Array.from({ length: MAX_ZONE_DOTS + 2 }, (_, i) => ({ id: `z${i}`, name: `zone-${i}`, color: '#3b82f6', count: 1 }))
    renderWithProviders(<PveNode {...props(pve({ zones, unzoned: 0, count: zones.length }))} />)
    expect(screen.getAllByRole('img')).toHaveLength(MAX_ZONE_DOTS)
    expect(screen.getByText('+2')).toBeTruthy()
  })
})

describe('the guests of a Proxmox node', () => {
  it('circles a guest in the colour the node view gives it, and leaves the other renderings as they were', () => {
    const data: GuestNodeData = { kind: 'guest', member: member(100, 'web-1'), groupId: 'pve:pve1', color: '#ff5722', zone: 'web' }
    const { container } = renderWithProviders(<GuestNode {...props(data)} />)
    expect(container.querySelector('[data-color="#ff5722"]')).toBeTruthy()
    cleanup()
    const plain = renderWithProviders(<GuestNode {...props({ kind: 'guest', member: member(100, 'web-1'), groupId: 'zw' } satisfies GuestNodeData)} />)
    expect(plain.container.querySelector('[data-color]')).toBeNull()
  })

  it('offers no button on a guest that cannot be targeted, and keeps its tooltip', async () => {
    const data: GuestNodeData = { kind: 'guest', member: member(100, 'old', [], { status: 'stopped' }), groupId: 'pve:pve1', color: '#ff5722', zone: 'web', inert: true }
    renderWithProviders(<GuestNode {...props(data)} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByLabelText('old, guest 100')).toBeTruthy()
    cleanup()
    renderWithProviders(<GuestNode {...props({ ...data, inert: false })} />)
    expect(screen.getByRole('button', { name: 'old, guest 100' })).toBeTruthy()
  })

  it('counts no guest on an empty node', () => {
    renderWithProviders(<PveNode {...props(pve({ count: 0, zones: [], unzoned: 0 }))} />)
    expect(screen.getByRole('group', { name: 'Proxmox node pve1, 0 guests' })).toBeTruthy()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('says how many more guests a node holds, without a button to a zone', () => {
    renderWithProviders(<MoreNode {...props({ kind: 'more', count: 3, groupId: 'pve:pve1' } satisfies MoreNodeData)} />)
    expect(screen.getByLabelText('3 more guests on this node')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
