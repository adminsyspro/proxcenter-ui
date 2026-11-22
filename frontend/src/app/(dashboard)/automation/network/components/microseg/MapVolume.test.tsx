/**
 * The sFlow volume on the map: the totals of the period, read once with the map (no request per edge), put a gauge
 * and the bytes at the head of the label of the edges between zones (every edge keeps one width), say their bytes on hover (tooltip, constellation label), in the matrix cells and the Sankey
 * ribbons. A connection sFlow does not measure keeps the map as it was.
 */

import { describe, expect, it } from 'vitest'

import { cleanup, within } from '@testing-library/react'

import { fireEvent, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { VOLUME_LEVELS } from '@/lib/microseg/volume'

import { RANGE_STORAGE_KEY } from '../useTimelineRange'

import { fetchMock, mock, reply } from './microsegTestKit'
import { db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, pathOf, setup, wouldBlock } from './zoneMapTestKit'

installFreshMocks()

const guests = [vm(100, 'web-1', ['zone-web'], { ips: ['10.0.0.1'] }), vm(200, 'db-1', ['zone-db'], { ips: ['10.0.0.2'] })]
// The allowed flow web -> db tcp/443 carried 4 MiB; the would-block flow web -> db tcp/80 1 KiB.
const MEASURED = {
  covered: true,
  buckets: [
    { at: new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString(), src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 443, bytes: 4 * 1024 * 1024, packets: 3000 },
    { at: new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString(), src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 80, bytes: 1024, packets: 2 },
  ],
}

const window1h = () => ({ step: 300, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() })

/** `byGuest`: the answer of the volume by pair of guests (none kept by default: the edges are told by their zones). */
function show(view: string, volume: unknown = MEASURED, byGuest: unknown = { covered: true, buckets: [] }, more: Parameters<typeof setup>[0] = {}) {
  window.localStorage.setItem('microseg.map.view', view)
  mock.routes['GET /volume?group=guest*'] = () => reply(200, { ...window1h(), ...(byGuest as object) })
  mock.routes['GET /volume*'] = () => reply(200, { ...window1h(), ...(volume as object) })
  return setup({ vms: guests, zones: [web(), db()], flows: [flowOf('f1')], suggestions: [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5 })], ...more })
}

const volumeReads = () => fetchMock.mock.calls.map(([u]) => String(u)).filter(u => u.includes('/volume?'))

describe('the sFlow volume on the map', () => {
  it('heads the label of an edge with a gauge and its bytes, every edge one width, read once with the totals of the period', async () => {
    show('groups')
    const gauge = await waitFor(async () => {
      const g = (await screen.findByRole('button', { name: /web to db: HTTPS/ })).querySelector('[data-testid=edge-volume-gauge]')
      expect(g).toBeTruthy()
      return g as HTMLElement
    })
    expect(gauge.dataset.level).toBe(String(VOLUME_LEVELS))
    expect(gauge.textContent).toBe('4 MiB')
    expect((await pathOf('allowed:zone:zw>zone:zd')).getAttribute('data-width')).toBeNull()
    // The observed flow drawn from guest to guest alone has the volume of its service between the two zones.
    const observed = (await screen.findByRole('button', { name: /web-1 \(web\) to db-1 \(db\)/ })).querySelector('[data-testid=edge-volume-gauge]') as HTMLElement
    expect(observed.textContent).toBe('1 KiB')
    expect(observed.dataset.level).toBe('2')
    // Two reads with the map, both totals of the period: between the zones, and by pair of guests.
    expect(volumeReads()).toHaveLength(2)
    expect(volumeReads().every(u => u.includes('totals=1'))).toBe(true)
    expect(volumeReads().filter(u => u.includes('group=guest'))).toHaveLength(1)
  })

  it('gives each edge drawn from a guest to a guest the volume of its own pair of guests, another pair of the same zones apart', async () => {
    const at = new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString()
    const tcp80 = { at, src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 80 }
    // Two guests of web send tcp/80 to db-1: 3 KiB between the zones, 1 KiB from web-1 and 2 KiB from web-2.
    const zones = { covered: true, buckets: [{ ...tcp80, bytes: 3072, packets: 6 }] }
    const byGuest = { covered: true, buckets: [{ ...tcp80, src_vmid: 100, dst_vmid: 200, bytes: 1024, packets: 2 }, { ...tcp80, src_vmid: 101, dst_vmid: 200, bytes: 2048, packets: 4 }] }
    show('groups', zones, byGuest, {
      vms: [...guests, vm(101, 'web-2', ['zone-web'], { ips: ['10.0.0.3'] })],
      suggestions: [wouldBlock('s1', { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 5, pairs: [{ src_ip: '10.0.0.1', dst_ip: '10.0.0.2', hits: 2 }, { src_ip: '10.0.0.3', dst_ip: '10.0.0.2', hits: 3 }] })],
    })
    const gaugeOf = async (name: RegExp) => (await screen.findByRole('button', { name })).querySelector('[data-testid=edge-volume-gauge]') as HTMLElement
    await waitFor(async () => expect((await gaugeOf(/web-1 \(web\) to db-1 \(db\)/))?.textContent).toBe('1 KiB'))
    expect((await gaugeOf(/web-2 \(web\) to db-1 \(db\)/)).textContent).toBe('2 KiB')
    // Its chart reads the volume of its guests, in their cluster.
    const label = await screen.findByRole('button', { name: /web-2 \(web\) to db-1 \(db\)/ })
    fireEvent.mouseOver(label.firstElementChild ?? label)
    await screen.findByTestId('edge-volume-spark')
    await waitFor(() => expect(volumeReads().some(u => u.includes('group=guest') && u.includes('src_vmid=101') && u.includes('dst_vmid=200'))).toBe(true))
    expect(screen.queryByTestId('edge-pair-volume')).toBeNull()
  })

  it('puts no gauge on a connection sFlow does not measure', async () => {
    show('groups', { covered: false, buckets: [] })
    await waitFor(() => expect(volumeReads()).toHaveLength(1))
    await screen.findByRole('button', { name: /web to db: HTTPS/ })
    expect(document.querySelector('[data-testid=edge-volume-gauge]')).toBeNull()
  })

  it('says the bytes of an edge on hover from the totals already read, its chart the only read', async () => {
    show('groups')
    await waitFor(() => expect(document.querySelector('[data-testid=edge-volume-gauge]')).toBeTruthy())
    const reads = fetchMock.mock.calls.length
    const label = await screen.findByRole('button', { name: /web to db: HTTPS/ })
    fireEvent.mouseOver(label.firstElementChild ?? label)
    expect((await screen.findByTestId('edge-volume')).textContent).toBe('Volume4 MiB')
    expect(screen.getByText('Packets').nextSibling!.textContent).toBe('3K')
    // The map shows the flows seen whenever: their volume is told over the last 24 hours.
    expect(screen.getByText('Volume measured by sFlow, last 24 h')).toBeTruthy()
    const after = fetchMock.mock.calls.slice(reads).map(([u]) => String(u))
    expect(after.every(u => u.includes('/volume?') && u.includes('src_zone=web'))).toBe(true)
  })

  it('charts the volume of an edge in its tooltip, read when it opens, narrowed to its pair of zones', async () => {
    show('groups')
    await waitFor(() => expect(document.querySelector('[data-testid=edge-volume-gauge]')).toBeTruthy())
    expect(volumeReads().filter(u => u.includes('src_zone='))).toHaveLength(0)
    const label = await screen.findByRole('button', { name: /web to db: HTTPS/ })
    fireEvent.mouseOver(label.firstElementChild ?? label)
    const spark = await screen.findByTestId('edge-volume-spark')
    await waitFor(() => expect(spark.textContent).toBe('Over 24 h, peak 4 MiB'))
    const edgeRead = volumeReads().find(u => u.includes('src_zone='))!
    expect(edgeRead).toContain('src_zone=web')
    expect(edgeRead).toContain('dst_zone=db')
    expect(edgeRead).not.toContain('group=')
  })

  it('writes the bytes of a pair in its matrix cell', async () => {
    show('matrix')
    expect((await screen.findByTestId('matrix-volume')).textContent).toBe('4 MiB')
  })

  it('says the bytes of a hovered arc of the constellation', async () => {
    show('constellation')
    await waitFor(() => expect(document.querySelectorAll('[data-arc]').length).toBeGreaterThan(0))
    const allowed = document.querySelector('[data-arc][data-kind="allowed"]') as HTMLElement
    // One width whatever the volume.
    expect(Number(allowed.querySelector('.line')!.getAttribute('stroke-width'))).toBe(1.5)
    fireEvent.pointerEnter(allowed)
    await waitFor(() => expect(document.querySelector(`[data-arc-label="${allowed.dataset.arc}"]`)?.textContent).toContain('4 MiB'))
  })

  it('says the bytes of a Sankey ribbon', async () => {
    show('sankey')
    await waitFor(() => expect(document.body.textContent).toContain('web'))
    const ribbon = await waitFor(() => { const r = document.querySelector('[data-ribbon^="allowed:"]'); expect(r).toBeTruthy(); return r! })
    expect(ribbon.getAttribute('aria-label')).toContain('4 MiB')
  })

  it('opens on a ribbon of the Sankey diagram the same card as on an edge of the map, under the two ends of the ribbon', async () => {
    show('sankey')
    const ribbon = await waitFor(() => { const r = document.querySelector('[data-ribbon^="allowed:"]'); expect(r).toBeTruthy(); return r! })
    fireEvent.mouseOver(ribbon)
    const card = await screen.findByTestId('edge-card')
    // Measured, the ribbons follow the volume: the note above the diagram says so.
    expect(screen.getByText('A ribbon is as wide as the volume sFlow measured for its flows. One without any is drawn thin.')).toBeTruthy()
    expect(within(card).getByTestId('edge-card-heading').textContent).toBe('web → db')
    expect(within(card).getByText('Allowed: HTTPS (tcp/443)')).toBeTruthy()
    expect(within(card).getByTestId('edge-volume').textContent).toBe('Volume4 MiB')
    expect(await within(card).findByTestId('edge-volume-spark')).toBeTruthy()
  })

  it('writes a volume estimated on a few samples with "≈" in every view: matrix, panel, Sankey, constellation', async () => {
    const few = { covered: true, buckets: MEASURED.buckets.map(b => ({ ...b, samples: 2 })) }
    mock.routes['GET /traffic*'] = () => reply(200, { step: 300, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 1000).toISOString(), buckets: [] })
    show('matrix', few)
    expect((await screen.findByTestId('matrix-volume')).textContent).toBe('≈ 4 MiB')
    fireEvent.click(await waitFor(() => screen.getByRole('gridcell', { name: /^web to db:/ })))
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    expect((await within(panel).findByTestId('volume-summary')).textContent).toBe('Measured by sFlow over the range: ≈ 4 MiB, 3,002 packets')
    cleanup()

    show('sankey', few)
    const ribbon = await waitFor(() => { const r = document.querySelector('[data-ribbon^="allowed:"]'); expect(r).toBeTruthy(); return r! })
    expect(ribbon.getAttribute('aria-label')).toContain('≈ 4 MiB')
    cleanup()

    show('constellation', few)
    await waitFor(() => expect(document.querySelectorAll('[data-arc]').length).toBeGreaterThan(0))
    const allowed = document.querySelector('[data-arc][data-kind="allowed"]') as HTMLElement
    fireEvent.pointerEnter(allowed)
    await waitFor(() => expect(document.querySelector(`[data-arc-label="${allowed.dataset.arc}"]`)?.textContent).toContain('≈ 4 MiB'))
  })

  it('charts the volume of a pair in its panel over the period of the map, on the Volume first, its range the panel\'s own', async () => {
    mock.routes['GET /traffic*'] = () => reply(200, { step: 300, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 1000).toISOString(), buckets: [] })
    show('matrix')
    await screen.findByRole('grid')
    const cell = await waitFor(() => screen.getByRole('gridcell', { name: /^web to db:/ }))
    fireEvent.click(cell)
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    const traffic = within(panel).getByRole('region', { name: 'Observed traffic' })
    expect((await within(traffic).findByTestId('volume-summary')).textContent).toBe('Measured by sFlow over the range: 4 MiB, 3,002 packets')
    // The map shows every period seen ("whenever"): the panel starts on the last 24 hours, in its steps of 30 minutes.
    expect(volumeReads().find(u => u.includes('group=pair'))).toContain('step=1800')
    expect(within(traffic).getByTestId('range-24h').getAttribute('aria-pressed')).toBe('true')
    expect(within(traffic).getByTestId('volume-tab').getAttribute('aria-pressed')).toBe('true')
    expect(within(traffic).getByTestId('timeline-caption').textContent).toContain('sFlow')
    // Another range in the panel stays the panel's: the range the browser remembers (the Dashboard's) is untouched.
    fireEvent.click(within(traffic).getByTestId('range-1h'))
    await waitFor(() => expect(within(traffic).getByTestId('range-1h').getAttribute('aria-pressed')).toBe('true'))
    expect(window.localStorage.getItem(RANGE_STORAGE_KEY)).toBeNull()
  })
})
