/**
 * The strip of the clusters of a shared policy on the Dashboard: one tile per cluster, sorted by name, after "All
 * clusters", on one line that scrolls; its state, members and drifts from its own status and drifts; a click filters,
 * a second one or "All clusters" clears; a cluster outside the user's scope is named in general words and never read.
 * No automatic RTL cleanup in this repo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegCluster } from '@/lib/microseg/types'

import ClusterStrip from './ClusterStrip'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  try { window.localStorage.clear() } catch { /* no storage */ }
})

const link = (connection_id: string, over: Partial<MicrosegCluster> = {}): MicrosegCluster =>
  ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null, ...over })
const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }, { id: 'c3', name: 'PVE-LAB3' }]

type Engine = { unreachable_since?: string; cluster_firewall?: string }
function stub(statuses: Record<string, { stop?: boolean; engine?: Engine } | 'error'>, drifts: Record<string, number> = {}) {
  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const id = url.split('/microseg/')[1]?.split('/')[0] ?? ''
    if (url.endsWith('/status')) {
      const s = statuses[id]
      if (!s || s === 'error') return answer({ code: 'UNAVAILABLE', error: 'no' }, 502)
      return answer({
        engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'enabled', ...(s.engine ?? {}) },
        coverage: { running: 10, zoned: 8, members: 8, protected: 5 }, zones_by_state: {}, emergency_stop: !!s.stop,
      })
    }
    if (url.endsWith('/drifts')) {
      const count = drifts[id] ?? 0
      return answer({ computed: true, drifts: Array.from({ length: count }, (_, i) => ({ kind: 'unzoned_running', guest: { type: 'lxc', vmid: 300 + i } })) })
    }
    return answer({ code: 'NOT_FOUND', error: 'no' }, 404)
  }))
}

function show(links: MicrosegCluster[], props: Partial<Parameters<typeof ClusterStrip>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onOpenDrifts: vi.fn() }
  renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, provider: () => new Map() }}>
      <ClusterStrip connectionId='c1' links={links} connections={CONNECTIONS} selected={null} missing={new Set()} {...handlers} {...props} />
    </SWRConfig>,
  )
  return handlers
}

const tiles = () => screen.getAllByTestId('cluster-tile')
const tile = (name: string) => tiles().find(t => t.getAttribute('data-cluster') === name)!
const detail = (name: string) => within(tile(name)).getByTestId('cluster-tile-detail').textContent
const statusReads = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u)).filter(u => u.endsWith('/status'))

describe('ClusterStrip', () => {
  it('shows "All clusters" then one tile per cluster sorted by name, on one line that scrolls and never wraps', async () => {
    stub({ c1: {}, c2: {}, c3: {} })
    show([link('c1'), link('c2'), link('c3')])

    expect(screen.getByTestId('cluster-tile-all').textContent).toBe('All clusters3 clusters')
    expect(tiles().map(t => t.getAttribute('data-cluster'))).toEqual(['PVE-DR', 'PVE-LAB3', 'PVE-PROD'])
    const row = screen.getByRole('group')
    expect(getComputedStyle(row).flexWrap).toBe('nowrap')
    expect(getComputedStyle(row).overflowX).toBe('auto')
    // A tight two-line tile.
    expect(getComputedStyle(tile('PVE-DR')).height).toBe('52px')
    await waitFor(() => expect(detail('PVE-DR')).toBe('Applied · 8 members · 5 protected'))
  })

  it.each([
    ['emergency stop first', { stop: true, engine: { unreachable_since: '2026-11-17T08:00:00Z', cluster_firewall: 'disabled' } }, 'Emergency stop'],
    ['then unreachable since', { engine: { unreachable_since: '2026-11-17T08:00:00Z', cluster_firewall: 'disabled' } }, 'Unreachable since'],
    ['then the cluster firewall off', { engine: { cluster_firewall: 'disabled' } }, 'Cluster firewall off'],
  ] as const)('says one state per tile: %s', async (_name, status, text) => {
    stub({ c1: {}, c2: status })
    show([link('c1'), link('c2', { active: false })])

    await waitFor(() => expect(detail('PVE-DR')).toContain(text))
    expect(detail('PVE-DR')).not.toContain('·  ·')
  })

  it('says a link not applied yet, and an unknown state when its status cannot be read', async () => {
    stub({ c1: 'error', c2: {} })
    show([link('c1'), link('c2', { active: false })])

    await waitFor(() => expect(detail('PVE-DR')).toContain('applies at the next application'))
    await waitFor(() => expect(detail('PVE-PROD')).toBe('State unknown'))
  })

  it('filters on a tile, clears on a second click or on "All clusters", and dims the others', async () => {
    stub({ c1: {}, c2: {} })
    const { onSelect } = show([link('c1'), link('c2')], { selected: 'c2' })

    expect(tile('PVE-DR').dataset.selected).toBe('true')
    expect(getComputedStyle(tile('PVE-PROD')).opacity).toBe('0.55')
    expect(screen.getByTestId('cluster-tile-all').dataset.selected).toBe('false')
    fireEvent.click(within(tile('PVE-PROD')).getByTestId('cluster-tile-button'))
    expect(onSelect).toHaveBeenLastCalledWith('c1')
    fireEvent.click(within(tile('PVE-DR')).getByTestId('cluster-tile-button'))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    fireEvent.click(within(screen.getByTestId('cluster-tile-all')).getByRole('button'))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('opens the Drifts sub-tab from the drift count, without filtering', async () => {
    stub({ c1: {}, c2: {} }, { c2: 2 })
    const { onSelect, onOpenDrifts } = show([link('c1'), link('c2')])

    const count = await within(await waitFor(() => tile('PVE-DR'))).findByTestId('cluster-tile-drifts')
    await waitFor(() => expect(count.textContent).toBe('2 drifts'))
    await waitFor(() => expect(within(tile('PVE-PROD')).getByTestId('cluster-tile-drifts').textContent).toBe('No drift'))
    fireEvent.click(count)
    expect(onOpenDrifts).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('puts the name and the drift count on the first line, the state and the members on the second: nothing overlaps', async () => {
    stub({ c1: {}, c2: {} }, { c2: 31 })
    show([link('c1'), link('c2')])

    const drifts = await within(tile('PVE-DR')).findByTestId('cluster-tile-drifts')
    await waitFor(() => expect(drifts.textContent).toBe('31 drifts'))
    await waitFor(() => expect(detail('PVE-DR')).toBe('Applied · 8 members · 5 protected'))
    const head = within(tile('PVE-DR')).getByTestId('cluster-tile-head')
    const state = within(tile('PVE-DR')).getByTestId('cluster-tile-state')
    // Two lines one under the other, each its own row: the count ends the first, the detail is cut in the second.
    expect(getComputedStyle(tile('PVE-DR')).flexDirection).toBe('column')
    expect(head.contains(within(tile('PVE-DR')).getByTestId('cluster-tile-name'))).toBe(true)
    expect(head.contains(drifts)).toBe(true)
    expect(head.lastElementChild).toBe(drifts)
    expect(state.contains(within(tile('PVE-DR')).getByTestId('cluster-tile-detail'))).toBe(true)
    expect(state.contains(drifts)).toBe(false)
    expect(head.contains(state) || state.contains(head)).toBe(false)
    expect(getComputedStyle(within(state).getByTestId('cluster-tile-detail')).textOverflow).toBe('ellipsis')
    expect(getComputedStyle(head).minWidth).toBe('0px')
    expect(getComputedStyle(tile('PVE-DR')).height).toBe('52px')
    // The tile stays one button (named by the cluster), the drift count a link of its own above it.
    expect(within(tile('PVE-DR')).getByTestId('cluster-tile-button').getAttribute('aria-label')).toBe('PVE-DR')
    expect(within(tile('PVE-DR')).getByTestId('cluster-tile-button').contains(drifts)).toBe(false)
  })

  describe('a second line that does not fit the tile', () => {
    // jsdom has no layout: 6 px a character, and the room the second line has in the tile.
    const room = { width: 400 }
    const restore: (() => void)[] = []
    beforeEach(() => {
      // jsdom has no ResizeObserver: this one answers once when it starts, as the browser's does.
      vi.stubGlobal('ResizeObserver', class { constructor(private cb: () => void) {} observe() { this.cb() } disconnect() {} unobserve() {} })
      const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
      const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.dataset.testid === 'cluster-tile-detail' ? (this.textContent ?? '').length * 6 : 0 } })
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.dataset.testid === 'cluster-tile-detail' ? room.width : 0 } })
      restore.push(() => {
        // jsdom defines both on Element: the override on HTMLElement is removed, not restored.
        if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scroll)
        else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
        if (client) Object.defineProperty(HTMLElement.prototype, 'clientWidth', client)
        else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
      })
    })
    afterEach(() => { while (restore.length) restore.pop()!() })

    it('shows the whole text, with no hover text, when it fits', async () => {
      room.width = 400
      stub({ c1: {}, c2: {} })
      show([link('c1'), link('c2')])

      await waitFor(() => expect(detail('PVE-DR')).toBe('Applied · 8 members · 5 protected'))
      expect(within(tile('PVE-DR')).getByTestId('cluster-tile-button').getAttribute('title')).toBeNull()
    })

    it('shortens it deliberately, the state then the two figures, instead of cutting a word, and says the whole on hover', async () => {
      room.width = 170
      stub({ c1: {}, c2: {} })
      show([link('c1'), link('c2')])

      await waitFor(() => expect(detail('PVE-DR')).toBe('Applied · 8 · 5 protected'))
      expect(within(tile('PVE-DR')).getByTestId('cluster-tile-button').getAttribute('title')).toBe('Applied · 8 members · 5 protected')
    })

    it('keeps the missing figures in the short text, and still cuts with an ellipsis when even that is too long', async () => {
      room.width = 100
      stub({ c1: {}, c2: {} })
      show([link('c1'), link('c2')], { missing: new Set(['c2']) })

      await waitFor(() => expect(detail('PVE-DR')).toBe('Applied · Figures missing · 8 · 5 protected'))
      expect(getComputedStyle(within(tile('PVE-DR')).getByTestId('cluster-tile-detail')).textOverflow).toBe('ellipsis')
      expect(within(tile('PVE-DR')).getByTestId('cluster-tile-button').getAttribute('title')).toBe('Applied · Figures missing · 8 members · 5 protected')
    })
  })

  it('says on its tile that the figures of a cluster are missing', async () => {
    stub({ c1: {}, c2: {} })
    show([link('c1'), link('c2')], { missing: new Set(['c2']) })

    await waitFor(() => expect(detail('PVE-DR')).toBe('Applied · Figures missing · 8 members · 5 protected'))
    expect(tile('PVE-DR').dataset.missing).toBe('true')
  })

  it('names a cluster outside the user\'s scope in general words, cannot pick it, never reads it, and says its traffic is left out', async () => {
    stub({ c1: {} })
    show([link('c1'), link('secret-id')])

    expect(tiles().map(t => t.getAttribute('data-cluster'))).toEqual(['Another cluster', 'PVE-PROD'])
    expect(within(tile('Another cluster')).queryByRole('button')).toBeNull()
    expect(detail('Another cluster')).toBe('Outside your scope')
    expect(screen.getByTestId('cluster-strip-hidden').textContent).toBe('The traffic of 1 cluster outside your scope is not included.')
    await waitFor(() => expect(statusReads()).toEqual(['/api/v1/firewall/microseg/c1/status']))
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('secret-id'))).toBe(false)
    expect(document.body.textContent).not.toContain('secret-id')
  })

  it('says nothing of a hidden cluster when every cluster is in scope', () => {
    stub({ c1: {}, c2: {} })
    show([link('c1'), link('c2')])
    expect(screen.queryByTestId('cluster-strip-hidden')).toBeNull()
  })
})
