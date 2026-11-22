/**
 * The edge of the zone map on its own: the label, its click and keyboard handling, and the tooltip of details the
 * label shows on hover, for each kind of edge (allowed, outside, unprotected, blocked) and each kind of end.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { EdgeProps } from '@xyflow/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow, MicrosegSuggestion } from '@/lib/microseg/types'

import { EdgeClickContext, EdgeVolumeContext, FlowEdge, MapNamesContext, type EdgeVolumeSource, type MapNames } from './FlowEdge'
import type { MapEdgeData, MapEdgeKind } from './zoneGraph'

vi.mock('@xyflow/react', async () => (await import('./xyflowTestMock')).xyflowMock)

afterEach(cleanup)

const NAMES: MapNames = {
  zone: id => ({ zw: 'web', zd: 'db' })[id] ?? id,
  end: id => `end(${id})`,
  short: id => `short(${id})`,
}

const seen = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', connection_id: 'c1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.1', src_zone_id: 'zw', dst_ip: '10.0.0.2', dst_zone_id: 'zd',
  proto: 'tcp', dport: '22', hits: 14, first_seen: '2026-11-02T10:00:00Z', last_seen: '2026-11-02T11:00:00Z', status: 'pending', ...over,
})

type EdgeData = MapEdgeData & { dimmed?: boolean }

const edgeData = (kind: MapEdgeKind, over: Partial<EdgeData> = {}): EdgeData => ({
  kind, services: ['tcp/22', 'tcp/443'], label: 'tcp/22, 443', count: 1, hits: null, exceptions: [], exceptionCount: 0, flows: [] as MicrosegFlow[], observed: [], draft: false,
  fromGroup: 'zone:zw', toGroup: 'zone:zd', path: 'M0 0 L400 0', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }],
  label_x: 200, label_y: 0, label_w: 150, label_h: 22, small: false, particle: false, color: '#2e7d32', ...over,
})

function renderEdge(source: string, target: string, data: EdgeData, onClick = vi.fn(), volume: EdgeVolumeSource | null = null) {
  const props = { id: 'e1', source, target, data, style: { stroke: data.color }, markerEnd: 'url(#arrow)' } as unknown as EdgeProps
  renderWithProviders(
    <EdgeClickContext.Provider value={onClick}>
      <MapNamesContext.Provider value={NAMES}>
        <EdgeVolumeContext.Provider value={volume}>
          <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, provider: () => new Map() }}>
            <svg><FlowEdge {...props} /></svg>
          </SWRConfig>
        </EdgeVolumeContext.Provider>
      </MapNamesContext.Provider>
    </EdgeClickContext.Provider>,
  )
  return onClick
}

/** Hovers the label and returns the text of the tooltip it opens. */
async function hoverDetails(label: string): Promise<string> {
  await userEvent.hover(screen.getByText(label))
  return (await screen.findByRole('tooltip')).textContent ?? ''
}

describe('the tooltip of an edge', () => {
  it('lists the grouped ports of an allowed edge', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed'))
    const text = await hoverDetails('tcp/22, 443')
    expect(text).toContain('Allowed: SSH (tcp/22), HTTPS (tcp/443)')
    expect(text).not.toContain('In the draft')
  })

  it('shows the label it was given and puts the name and the port of every service in the tooltip', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { services: ['tcp/22', 'tcp/8080', 'tcp/42001'], label: 'SSH, HTTP-alt, tcp/42001' }))
    const text = await hoverDetails('SSH, HTTP-alt, tcp/42001')
    expect(text).toContain('Allowed: SSH (tcp/22), HTTP-alt (tcp/8080), tcp/42001')
  })

  it('says a draft-only allowed edge is applied with the next plan', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { draft: true }))
    expect(await hoverDetails('tcp/22, 443')).toContain('In the draft: applied with the next plan')
  })

  it('says a flow to Outside is not blocked', async () => {
    renderEdge('zone:zw', 'outside', edgeData('outside', { services: ['udp/53'], label: 'udp/53', color: '#9e9e9e' }))
    expect(await hoverDetails('udp/53')).toContain('Outbound not blocked: DNS (udp/53)')
  })

  it('shows the sample pair and the zone hits of an unprotected edge between guests', async () => {
    const observed = [seen('s1'), seen('s2', { dport: '', proto: 'icmp', hits: 1 })]
    renderEdge('guest:zw:qemu/100', 'guest:zd:qemu/200', edgeData('unprotected', { count: 2, observed, small: true, label: 'tcp/22', color: '#e53935' }))
    const text = await hoverDetails('tcp/22')
    expect(text).toContain('2 observed flows that no flow allows (unprotected)')
    expect(text).toContain('Example: short(guest:zw:qemu/100) → short(guest:zd:qemu/200)')
    // The table of its observed flows under its column names; the note of the sample pair in the small print, last.
    expect(screen.getByTestId('edge-observed').textContent).toMatch(/^ServiceHitsLast seen/)
    expect(screen.getByTestId('edge-notes').textContent).toBe('Hits counted between the two zones (sample pair shown)')
    expect(text.indexOf('Last seen')).toBeLessThan(text.indexOf('Hits counted between'))
    // One line per observed flow: its service, its hits, when it was last seen.
    const rows = screen.getAllByTestId('edge-observed-row').map(r => [...r.children].map(c => c.textContent))
    expect(rows[0].slice(0, 2)).toEqual(['SSH (tcp/22)', '14'])
    expect(rows[1].slice(0, 2)).toEqual(['icmp', '1'])
    expect(rows[0][2]).toMatch(/ago|in /)
    expect(screen.getByTestId('edge-card')).toBeTruthy()
  })

  it('names the source address of a blocked flow from External, the unknown source too, and caps the list', async () => {
    const observed = [
      seen('s1', { kind: 'blocked', src_zone_id: '', src_ip: '203.0.113.9' }),
      seen('s2', { kind: 'blocked', src_zone_id: '', src_ip: '' }),
      ...['s3', 's4', 's5', 's6', 's7'].map(id => seen(id, { kind: 'blocked', src_zone_id: '', src_ip: '198.51.100.1', last_seen: 'not a date' })),
    ]
    renderEdge('external', 'zone:zd', edgeData('blocked', { count: 7, observed, label: 'tcp/22', color: '#1565c0' }))
    const text = await hoverDetails('tcp/22')
    expect(text).toContain('7 flows blocked by an enforced zone')
    expect(text).not.toContain('Example:')
    expect(screen.getByTestId('edge-observed').textContent).toMatch(/^ServiceHitsLast seen/)
    expect(screen.queryByTestId('edge-notes')).toBeNull()
    const rows = screen.getAllByTestId('edge-observed-row').map(r => [...r.children].map(c => c.textContent))
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual(['SSH (tcp/22) · 203.0.113.9', '14', expect.any(String)])
    expect(rows[1][0]).toBe('SSH (tcp/22) · Unknown')
    expect(rows[2][2]).toBe('not a date')
    expect(text).toContain('+2 more')
  })
})

describe('the volume in the tooltip of an edge', () => {
  it('sets what a shared edge counts beside its whole pair of zones, the figure of its panel', async () => {
    renderEdge('guest:zw:qemu/100', 'guest:zd:qemu/200', edgeData('blocked', {
      count: 1, observed: [seen('s1', { kind: 'blocked' })], small: true, label: 'tcp/22', color: '#1565c0',
      volume: { bytes: 1024, packets: 2 }, volumeLevel: 2, volumeShared: true, volumePair: { from: 'web', to: 'db', figure: { bytes: 4096, packets: 9 } },
    }))
    await hoverDetails('tcp/22')
    expect(screen.getByTestId('edge-volume').textContent).toBe('Volume, this edge1 KiB')
    expect(screen.getByTestId('edge-pair-volume').textContent).toBe('Whole pair4 KiB')
  })

  it('charts the whole pair of a shared edge, its own part being nothing, read narrowed to that pair', async () => {
    const now = Date.now()
    const fetchMock = vi.fn(async (url: string) => {
      const body = { step: 1800, from: new Date(now - 86_400_000).toISOString(), to: new Date(now).toISOString(), covered: true, buckets: [{ at: new Date(now - 3_600_000).toISOString(), src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 3306, bytes: 4096, packets: 9 }] }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body, url }
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEdge('guest:zw:qemu/100', 'guest:zd:qemu/200', edgeData('blocked', {
      count: 1, observed: [seen('s1', { kind: 'blocked' })], small: true, label: 'tcp/22', color: '#1565c0',
      volume: { bytes: 0, packets: 0 }, volumeLevel: 0, volumeShared: true, volumePair: { from: 'web', to: 'db', figure: { bytes: 4096, packets: 9 } },
    }), vi.fn(), { clusterIds: ['c1'], period: 'all', zoneName: id => NAMES.zone(id) })
    await hoverDetails('tcp/22')
    const spark = await screen.findByTestId('edge-volume-spark')
    await vi.waitFor(() => expect(spark.textContent).toBe('Whole pair web → db over 24 h, peak 4 KiB'), { timeout: 3000 })
    const read = String(fetchMock.mock.calls.find(([u]) => String(u).includes('/volume?'))![0])
    expect(screen.getByTestId('edge-volume-shared').textContent).toBe('All its traffic is counted on other edges: the chart shows the whole pair')
    expect(read).toContain('src_zone=web')
    expect(read).toContain('dst_zone=db')
    vi.unstubAllGlobals()
  })

  it('writes a volume estimated on a few samples with "≈", on its label and in its card, and says how many', async () => {
    renderEdge('guest:zw:qemu/100', 'guest:zd:qemu/200', edgeData('blocked', {
      count: 1, observed: [seen('s1', { kind: 'blocked' })], small: true, label: 'tcp/22', color: '#1565c0',
      volume: { bytes: 39_936, packets: 512, samples: 1 }, volumeLevel: 1,
    }))
    expect(screen.getByTestId('edge-volume-gauge').textContent).toBe('≈ 39 KiB')
    await hoverDetails('tcp/22')
    expect(screen.getByTestId('edge-volume').textContent).toBe('Volume≈ 39 KiB')
    expect(screen.getByTestId('edge-volume-estimate').textContent).toBe('≈ estimate on 1 sFlow sample')
  })

  it('writes a volume on enough samples, or whose samples are not told, as it is', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { volume: { bytes: 2048, packets: 5120, samples: 10 }, volumeLevel: 4 }))
    expect(screen.getByTestId('edge-volume-gauge').textContent).toBe('2 KiB')
    await hoverDetails('tcp/22, 443')
    expect(screen.queryByTestId('edge-volume-estimate')).toBeNull()
  })

  it('says the rest of the pair is not told by guest when nothing of the edge is on another edge', async () => {
    renderEdge('guest:zw:qemu/100', 'guest:zd:qemu/200', edgeData('blocked', {
      count: 1, observed: [seen('s1', { kind: 'blocked' })], small: true, label: 'tcp/22', color: '#1565c0',
      volume: { bytes: 2048, packets: 4 }, volumeLevel: 2, volumeShared: true, volumeUntold: true, volumePair: { from: 'web', to: 'db', figure: { bytes: 8192, packets: 9 } },
    }), vi.fn(), { clusterIds: ['c1'], period: 'all', zoneName: id => NAMES.zone(id) })
    await hoverDetails('tcp/22')
    expect(screen.getByTestId('edge-volume-shared').textContent).toBe('Rest of the pair not told by guest (counted before, or past the bound)')
    expect(screen.getByTestId('edge-pair-volume').textContent).toBe('Whole pair8 KiB')
  })

  it('gives the volume and the packets of an edge that counts all its traffic', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { volume: { bytes: 2048, packets: 3 }, volumeLevel: 4 }))
    await hoverDetails('tcp/22, 443')
    expect(screen.getByTestId('edge-volume').textContent).toBe('Volume2 KiB')
    expect(screen.queryByTestId('edge-pair-volume')).toBeNull()
    expect(screen.getByText('Measured by sFlow over the period of the map')).toBeTruthy()
  })
})

describe('the label of an edge', () => {
  it('names the edge for a screen reader and opens it on a click, Enter or Space', () => {
    const onClick = renderEdge('zone:zw', 'zone:zd', edgeData('allowed'))
    const label = screen.getByRole('button', { name: 'end(zone:zw) to end(zone:zd): SSH (tcp/22), HTTPS (tcp/443)' })
    fireEvent.click(label)
    fireEvent.keyDown(label, { key: 'Enter' })
    fireEvent.keyDown(label, { key: ' ' })
    fireEvent.keyDown(label, { key: 'a' })
    expect(onClick).toHaveBeenCalledTimes(3)
    expect(onClick).toHaveBeenCalledWith('e1')
  })

  it('counts the observed flows in the name of an observed edge, and dims with its edge', () => {
    renderEdge('external', 'zone:zd', edgeData('blocked', { count: 3, label: 'tcp/22', dimmed: true }))
    const label = screen.getByRole('button', { name: 'end(external) to end(zone:zd): 3 blocked flows' })
    expect(label.classList.contains('microseg-dim')).toBe(true)
    expect(screen.getByTestId('path-e1').classList.contains('microseg-dim')).toBe(true)
  })

  it('draws a particle along an applied allowed edge', () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { particle: true }))
    expect(document.querySelector('animateMotion')?.getAttribute('path')).toBe('M0 0 L400 0')
  })
})

describe('the exceptions on an edge', () => {
  it('counts the exceptions between two zones after the services of their allowed link', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { exceptionCount: 2 }))
    const label = screen.getByRole('button')
    expect(label.textContent).toBe('tcp/22, 443 · 2 exceptions')
    expect(label.getAttribute('aria-label')).toBe('end(zone:zw) to end(zone:zd): SSH (tcp/22), HTTPS (tcp/443) · 2 exceptions')
    expect(await hoverDetails('tcp/22, 443 · 2 exceptions')).toContain('2 exceptions between VMs of the two zones')
  })

  it('labels a link that only stands for exceptions with their count, dashed', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('exception', { services: [], label: '', exceptionCount: 1 }))
    const label = screen.getByRole('button')
    expect(label.textContent).toBe('1 exception')
    expect(label.getAttribute('aria-label')).toBe('end(zone:zw) to end(zone:zd): 1 exception')
    expect(getComputedStyle(screen.getByTestId('flow-label-e1')).borderStyle).toBe('dashed')
    const text = await hoverDetails('1 exception')
    expect(text).toContain('1 exception between VMs of the two zones')
    expect(text).not.toContain('Allowed:')
  })

  it('names the services of an exception between two guests, dashed, without a particle', async () => {
    renderEdge('guest:zw:qemu/101', 'guest:zd:qemu/102', edgeData('exception', { services: ['tcp/5432'], label: 'PostgreSQL', small: true }))
    expect(screen.getByRole('button').textContent).toBe('PostgreSQL')
    expect(getComputedStyle(screen.getByTestId('flow-label-e1')).borderStyle).toBe('dashed')
    expect(document.querySelector('animateMotion')).toBeNull()
    expect(await hoverDetails('PostgreSQL')).toContain('Exception: PostgreSQL (tcp/5432)')
  })

  it('keeps the label of an allowed edge solid', () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed'))
    expect(getComputedStyle(screen.getByTestId('flow-label-e1')).borderStyle).toBe('solid')
  })
})

describe('the tooltip of an edge of the node view', () => {
  // Two guests may carry one name: the rows are told apart by guest, not by name.
  const pairs = Array.from({ length: 7 }, (_, i) => ({ key: `qemu/${100 + i}>qemu/200`, from: i === 1 ? 'web-1' : `web-${i + 1}`, to: 'db-1', services: ['tcp/5432'] }))

  it('lists the guest pairs of an observed edge as the samples they are, the first ones then how many more', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderEdge('pve:pve1', 'pve:pve2', edgeData('unprotected', { label: 'PostgreSQL', count: 7, hits: 70, observed: [seen('s1')], guestPairs: pairs }))
    const text = await hoverDetails('PostgreSQL · 70')
    expect(text).toContain('Sample pairs kept by the engine:')
    expect(text).toContain('web-1 to db-1: PostgreSQL (tcp/5432)')
    expect(text).toContain('web-5 to db-1')
    expect(text).not.toContain('web-6 to db-1')
    expect(text).toContain('+2 more')
    expect(text).not.toContain('between zone')
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
  })

  it('lists the guest pairs of an exception without calling them samples', async () => {
    renderEdge('pve:pve1', 'pve:pve2', edgeData('exception', { services: ['tcp/5432'], label: 'PostgreSQL', guestPairs: pairs.slice(0, 1) }))
    const text = await hoverDetails('PostgreSQL')
    expect(text).toContain('Exception: PostgreSQL (tcp/5432)')
    expect(text).toContain('web-1 to db-1: PostgreSQL (tcp/5432)')
    expect(text).not.toContain('Sample pairs')
  })
})
