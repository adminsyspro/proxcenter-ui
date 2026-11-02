import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, alpha, createTheme } from '@mui/material/styles'
import type { ComponentProps } from 'react'

import en from '@/messages/en.json'
import type { CephInventory } from '@/lib/ceph/types'

import HostMap from './HostMap'

const theme = createTheme()
const RATIOS = { nearfull: 0.85, full: 0.95 }

type Osd = CephInventory['osds']['list'][number]

const osd = (id: number, host: string, over: Partial<Osd> = {}): Osd => ({
  id,
  name: `osd.${id}`,
  host,
  status: 'up',
  up: true,
  in: true,
  deviceClass: 'hdd',
  totalBytes: 0,
  usedBytes: 0,
  availBytes: 0,
  usedPct: 60,
  commitLatencyMs: 1.1,
  applyLatencyMs: 1.1,
  pgs: 43,
  version: '20.2.4',
  ...over,
})

const inventoryOf = (list: Osd[]): CephInventory => ({
  osds: { total: list.length, up: list.filter(o => o.up).length, in: list.filter(o => o.in).length, down: 0, out: 0, list },
  monitors: {
    total: 1, inQuorum: 1, quorumNames: ['node-a'],
    list: [{ name: 'node-a', host: 'node-a', addr: '', inQuorum: true, leader: true, storeStats: null }],
  },
  managers: { active: { name: 'node-a', host: 'node-a' }, standbys: [] },
  mds: { total: 0, list: [] },
}) as unknown as CephInventory

/** 500 OSDs over 60 hosts: 20 hosts carry 9, 40 carry 8. */
function bigCluster(): CephInventory {
  const list: Osd[] = []
  let id = 0

  for (let h = 0; h < 60; h++) {
    const count = h < 20 ? 9 : 8

    for (let i = 0; i < count; i++) {
      list.push(osd(id, `node-${String(h + 1).padStart(2, '0')}`, { usedPct: 40 + (id % 60) }))
      id++
    }
  }

  return inventoryOf(list)
}

function renderMap(props: Partial<ComponentProps<typeof HostMap>> & { inventory: CephInventory }) {
  const onOpenOsd = vi.fn()

  const view = render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <HostMap ratios={RATIOS} onOpenOsd={onOpenOsd} {...props} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )

  return { ...view, onOpenOsd }
}

afterEach(cleanup)

describe('HostMap', () => {
  it('shows one card per host with each OSD detailed up to 4 OSDs per host', () => {
    const { onOpenOsd } = renderMap({ inventory: inventoryOf([osd(0, 'node-a', { usedPct: 81.8 }), osd(1, 'node-b', { usedPct: 87.2 }), osd(2, 'node-c')]) })

    expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'cards')
    expect(screen.getAllByTestId('host-card')).toHaveLength(3)

    const row = screen.getByRole('button', { name: en.cephCockpit.overview.hostMap.open.replace('{id}', '1') })

    expect(row).toHaveTextContent('87%')
    expect(row).toHaveTextContent('43 PG')
    fireEvent.click(row)
    expect(onOpenOsd).toHaveBeenCalledWith(1)
  })

  it('leads each host with the Proxmox logo and its PVE status dot, each OSD with the disk glyph and its state dot', () => {
    const inventory = { ...inventoryOf([osd(0, 'node-a'), osd(1, 'node-b', { in: false }), osd(2, 'node-c', { up: false })]), pveNodes: ['node-a', 'node-b'], pveNodeStatus: { 'node-a': 'online', 'node-b': 'maintenance' } }

    renderMap({ inventory })

    const cards = screen.getAllByTestId('host-card')

    expect(cards[0].querySelector('img')).toHaveAttribute('src', expect.stringContaining('proxmox-logo'))
    expect(cards[0].querySelector('i.ri-server-line')).toBeNull()
    expect(cards[0].querySelector('img')?.nextElementSibling).toHaveStyle({ backgroundColor: 'rgb(76, 175, 80)' })
    expect(cards[1].querySelector('img')?.nextElementSibling).toHaveStyle({ backgroundColor: 'rgb(255, 152, 0)' })
    expect(cards[2].querySelector('img')?.nextElementSibling).toHaveStyle({ backgroundColor: 'rgb(158, 158, 158)' })
    const glyphDots = screen.getAllByTestId('osd-glyph-dot')

    expect(glyphDots).toHaveLength(3)
    expect(glyphDots[0]).toHaveStyle({ backgroundColor: 'rgb(76, 175, 80)' })
    expect(glyphDots[1]).toHaveStyle({ backgroundColor: 'rgb(255, 152, 0)' })
    expect(glyphDots[2]).toHaveStyle({ backgroundColor: 'rgb(244, 67, 54)' })
  })

  it('dense mode above 4 OSD per host', () => {
    const { container } = renderMap({ inventory: bigCluster() })

    expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'dense')
    expect(screen.getAllByTestId('osd-cell')).toHaveLength(500)
    expect(screen.getAllByTestId('host-row')).toHaveLength(60)
    // No card per OSD (nor per host): the section itself is the only card.
    expect(container.querySelectorAll('.MuiCard-root').length).toBeLessThanOrEqual(1)
    expect(screen.queryByTestId('host-card')).toBeNull()
    expect(screen.getAllByTestId('host-row')[0].querySelector('img')).toHaveAttribute('src', expect.stringContaining('proxmox-logo'))
  })

  it('down osd has error outline', () => {
    const list = Array.from({ length: 5 }, (_, i) => osd(i, 'node-a', i === 3 ? { up: false, usedPct: 0 } : {}))

    renderMap({ inventory: inventoryOf(list) })

    const cell = screen.getAllByTestId('osd-cell').find(c => c.getAttribute('data-osd') === '3')!

    expect(cell).toHaveAttribute('data-down', 'true')
    expect(cell.style.boxShadow).toContain(theme.palette.error.main)
    expect(screen.getByTestId('host-summary')).toHaveTextContent('1 down')
  })

  it('out osd dimmed', () => {
    const list = Array.from({ length: 5 }, (_, i) => osd(i, 'node-a', i === 2 ? { in: false } : {}))

    renderMap({ inventory: inventoryOf(list) })

    const cells = screen.getAllByTestId('osd-cell')
    const out = cells.find(c => c.getAttribute('data-osd') === '2')!

    expect(out).toHaveAttribute('data-out', 'true')
    expect(out).toHaveStyle({ opacity: '0.4' })
    expect(cells.find(c => c.getAttribute('data-osd') === '1')).not.toHaveStyle({ opacity: '0.4' })
  })

  it('colours a dense cell by its fill and marks a flagged OSD', () => {
    const list = Array.from({ length: 5 }, (_, i) => osd(i, 'node-a', { usedPct: [40, 75, 88, 97, 50][i] }))

    renderMap({ inventory: inventoryOf(list), osdFlags: { 'osd.4': ['noout'] } })

    const tones = screen.getAllByTestId('osd-cell').map(c => c.getAttribute('data-tone'))

    expect(tones).toEqual(['low', 'mid', 'nearfull', 'full', 'low'])
    expect(within(screen.getAllByTestId('osd-cell')[4]).getByTestId('osd-flag')).toBeInTheDocument()
    expect(screen.getByTestId('host-summary')).toHaveTextContent('max 97%')
  })

  it('opens the OSD from a dense cell', () => {
    const { onOpenOsd } = renderMap({ inventory: bigCluster() })

    fireEvent.click(screen.getAllByTestId('osd-cell')[7])
    expect(onOpenOsd).toHaveBeenCalledWith(7)
  })

  it('marks an OSD a health check points at', () => {
    renderMap({
      inventory: inventoryOf([osd(0, 'node-a'), osd(1, 'node-b')]),
      checks: [{ name: 'OSD_NEARFULL', severity: 'HEALTH_WARN', summary: '1 nearfull osd(s)', detail: [{ message: 'osd.1 is near full' }] }],
    })

    const row = screen.getByRole('button', { name: en.cephCockpit.overview.hostMap.open.replace('{id}', '1') })

    expect(row).toHaveTextContent('OSD_NEARFULL')
    expect(row).toHaveAttribute('data-state', 'warn')
  })

  it('names the services and flags of a host', () => {
    renderMap({ inventory: inventoryOf([osd(0, 'node-a')]), hostFlags: { 'node-a': ['noout'] } })

    const card = screen.getByTestId('host-card')

    expect(card).toHaveTextContent('mon')
    expect(card).toHaveTextContent(en.cephCockpit.overview.hostMap.mgrActive)
    expect(card).toHaveTextContent('noout')
  })

  it('sums up a dense cell on hover', async () => {
    const list = Array.from({ length: 5 }, (_, i) => osd(i, 'node-a', i === 4 ? { usedPct: 91.2, pgs: 12 } : {}))

    renderMap({
      inventory: inventoryOf(list),
      osdFlags: { 'osd.4': ['noout'] },
      checks: [{ name: 'OSD_NEARFULL', severity: 'HEALTH_WARN', summary: '1 nearfull osd(s)', detail: [{ message: 'osd.4 is near full' }] }],
    })

    fireEvent.mouseOver(screen.getAllByTestId('osd-cell')[4])
    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent('osd.4 · node-a · HDD')
    expect(tip).toHaveTextContent('91% used · up · in')
    expect(tip).toHaveTextContent('12 PG')
    expect(tip).toHaveTextContent('Flags: noout')
    expect(tip).toHaveTextContent('OSD_NEARFULL')
  })

  // The route turns a missing latency into 0; a value that is not a number is a missing reading, never "0 ms".
  it('shows a dash for a latency that was not measured', () => {
    const missing = { commitLatencyMs: undefined, applyLatencyMs: undefined } as unknown as Partial<Osd>

    renderMap({ inventory: inventoryOf([osd(0, 'node-a', missing), osd(1, 'node-b', { commitLatencyMs: 0, applyLatencyMs: 0 })]) })

    const rows = screen.getAllByTestId('host-osd')

    expect(rows[0]).toHaveTextContent('up · in · \u2013 ms · 43 PG')
    expect(rows[1]).toHaveTextContent('up · in · 0 ms · 43 PG')
  })

  it('fills each OSD card from the left up to its fill ratio, and not a down OSD', () => {
    renderMap({ inventory: inventoryOf([osd(0, 'node-a'), osd(1, 'node-b', { up: false })]) })

    const [upCard, downCard] = screen.getAllByTestId('host-osd')
    const gauge = getComputedStyle(upCard).backgroundImage

    expect(gauge).toContain('linear-gradient')
    expect(gauge).toMatch(/transparent \d+(\.\d+)?%/)
    expect(getComputedStyle(downCard).backgroundImage).not.toContain('linear-gradient')
  })

  describe('fill gauge past the thresholds', () => {
    const cardOf = (usedPct: number) => {
      renderMap({ inventory: inventoryOf([osd(0, 'node-a', { usedPct })]) })

      return screen.getByTestId('host-osd')
    }
    const warningTint = alpha(theme.palette.warning.main, 0.32)
    const errorTint = alpha(theme.palette.error.main, 0.32)
    const themeTint = alpha(theme.palette.primary.main, 0.16)

    it('below nearfull: the theme colour at 0.16, up to the fill percentage, no hatching, ring stroke 4', () => {
      const card = cardOf(60)
      const image = getComputedStyle(card).backgroundImage

      expect(image).toContain(themeTint)
      expect(image).toContain('transparent 60%')
      expect(image).not.toContain('repeating-linear-gradient')
      expect(card.querySelectorAll('circle')[1]).toHaveAttribute('stroke-width', '4')
    })

    it('nearfull: the warning colour at 0.32 with fine hatching on the filled part only, ring stroke 5', () => {
      const card = cardOf(88)
      const style = getComputedStyle(card)

      expect(style.backgroundImage).toContain(warningTint)
      expect(style.backgroundImage).toContain('transparent 88%')
      expect(style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(1)
      expect(style.backgroundSize).toBe('88% 100%, 100% 100%')
      expect(card).toHaveTextContent('88%')
      expect(card.querySelectorAll('circle')[1]).toHaveAttribute('stroke-width', '5')
    })

    it('full: the error colour at 0.32 with crossed hatching on the filled part only, ring stroke 5', () => {
      const card = cardOf(97)
      const style = getComputedStyle(card)

      expect(style.backgroundImage).toContain(errorTint)
      expect(style.backgroundImage).toContain('transparent 97%')
      expect(style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(2)
      expect(style.backgroundSize).toBe('97% 100%, 97% 100%, 100% 100%')
      expect(card).toHaveTextContent('97%')
      expect(card.querySelectorAll('circle')[1]).toHaveAttribute('stroke-width', '5')
    })

    it('a brand colour close to error does not change the pattern: hatching and thicker ring still mark nearfull', () => {
      const brand = createTheme({ palette: { primary: { main: '#F43F5E' } } })

      render(
        <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
          <ThemeProvider theme={brand}>
            <HostMap ratios={RATIOS} onOpenOsd={vi.fn()} inventory={inventoryOf([osd(0, 'node-a', { usedPct: 60 }), osd(1, 'node-b', { usedPct: 90 })])} />
          </ThemeProvider>
        </NextIntlClientProvider>,
      )

      const [normal, near] = screen.getAllByTestId('host-osd')

      expect(getComputedStyle(normal).backgroundImage).not.toContain('repeating-linear-gradient')
      expect(getComputedStyle(near).backgroundImage).toContain('repeating-linear-gradient')
      expect(near.querySelectorAll('circle')[1]).toHaveAttribute('stroke-width', '5')
      expect(normal.querySelectorAll('circle')[1]).toHaveAttribute('stroke-width', '4')
    })
  })

  describe('dense squares and legend past the thresholds', () => {
    const dense = () => renderMap({
      view: 'dense',
      inventory: inventoryOf([osd(0, 'node-a', { usedPct: 20 }), osd(1, 'node-a', { usedPct: 75 }), osd(2, 'node-a', { usedPct: 88 }), osd(3, 'node-a', { usedPct: 97 })]),
    })
    const cell = (id: number) => screen.getAllByTestId('osd-cell').find(c => c.getAttribute('data-osd') === String(id))!

    it('below nearfull the squares are soft steps of the theme colour: no hatching, no contour', () => {
      dense()
      for (const id of [0, 1]) {
        expect(cell(id).style.backgroundImage).not.toContain('repeating-linear-gradient')
        expect(cell(id).style.boxShadow).toBe('')
      }
      expect(cell(0).style.backgroundColor).toBe(alpha(theme.palette.primary.main, 0.28))
      expect(cell(1).style.backgroundColor).toBe(alpha(theme.palette.primary.main, 0.6))
    })

    it('nearfull: solid warning colour, one hatching direction, 1.5 px inner contour; full: solid error colour, crossed hatching', () => {
      dense()
      expect(cell(2)).toHaveAttribute('data-tone', 'nearfull')
      expect(cell(2).style.backgroundColor).toBe('rgb(237, 108, 2)')
      expect(cell(2).style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(1)
      expect(cell(2).style.boxShadow).toContain('1.5px')
      expect(cell(3)).toHaveAttribute('data-tone', 'full')
      expect(cell(3).style.backgroundColor).toBe('rgb(211, 47, 47)')
      expect(cell(3).style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(2)
      expect(cell(3).style.boxShadow).toContain('1.5px')
    })

    it('the legend swatches reuse the same patterns', () => {
      dense()

      const swatches = within(screen.getByTestId('host-map-legend')).getAllByTestId('host-map-swatch')

      // low, mid, nearfull, full, down, out, flag
      expect(swatches).toHaveLength(7)
      expect(swatches[0].style.backgroundImage).not.toContain('repeating-linear-gradient')
      expect(swatches[1].style.backgroundImage).not.toContain('repeating-linear-gradient')
      expect(swatches[2].style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(1)
      expect(swatches[3].style.backgroundImage.match(/repeating-linear-gradient/g)).toHaveLength(2)
      expect(swatches[2].style.boxShadow).toContain('1.5px')
      expect(swatches[3].style.boxShadow).toContain('1.5px')
    })
  })

  describe('view toggle (Compact / Dense)', () => {
    const small = () => inventoryOf([osd(0, 'node-a'), osd(1, 'node-b'), osd(2, 'node-c')])

    it('no explicit view: the automatic mode, and the control shows it', () => {
      renderMap({ inventory: small(), onViewChange: vi.fn() })
      expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'cards')
      expect(screen.getByTestId('host-map-view-compact')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('host-map-view-dense')).toHaveAttribute('aria-pressed', 'false')
      cleanup()
      renderMap({ inventory: bigCluster(), onViewChange: vi.fn() })
      expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'dense')
      expect(screen.getByTestId('host-map-view-dense')).toHaveAttribute('aria-pressed', 'true')
    })

    it('forced dense on a small cluster renders the squares', () => {
      renderMap({ inventory: small(), view: 'dense', onViewChange: vi.fn() })
      expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'dense')
      expect(screen.getAllByTestId('osd-cell')).toHaveLength(3)
      expect(screen.queryByTestId('host-card')).toBeNull()
    })

    it('forced compact on a big cluster renders the cards', () => {
      renderMap({ inventory: bigCluster(), view: 'compact', onViewChange: vi.fn() })
      expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'cards')
      expect(screen.getAllByTestId('host-card')).toHaveLength(60)
      expect(screen.queryByTestId('host-problem-toggle')).toBeNull()
    })

    it('the problem hosts switch follows the dense mode (forced or automatic)', () => {
      renderMap({ inventory: small(), view: 'dense', onViewChange: vi.fn() })
      expect(screen.queryByTestId('host-problem-toggle')).toBeNull()
      cleanup()
      renderMap({ inventory: bigCluster(), view: 'dense', onViewChange: vi.fn() })
      expect(screen.getByTestId('host-problem-toggle')).toBeTruthy()
    })

    it('clicking a segment reports it, including the one already shown', () => {
      const onViewChange = vi.fn()

      renderMap({ inventory: small(), onViewChange })
      fireEvent.click(screen.getByTestId('host-map-view-dense'))
      fireEvent.click(screen.getByTestId('host-map-view-compact'))
      expect(onViewChange.mock.calls).toEqual([['dense'], ['compact']])
    })

    it('without a handler there is no control', () => {
      renderMap({ inventory: small() })
      expect(screen.queryByTestId('host-map-view')).toBeNull()
    })
  })

  describe('problem hosts toggle', () => {
    const huge = (problemHost?: string) => {
      const list: Osd[] = []

      for (let h = 0; h < 45; h++) {
        const name = `node-${String(h + 1).padStart(2, '0')}`

        for (let i = 0; i < 6; i++) list.push(osd(h * 6 + i, name, name === problemHost && i === 0 ? { up: false, usedPct: 0 } : {}))
      }

      return inventoryOf(list)
    }

    it('is not offered up to 40 hosts, nor in cards mode', () => {
      renderMap({ inventory: bigCluster().osds.list.length ? { ...bigCluster(), osds: { ...bigCluster().osds, list: bigCluster().osds.list.filter(o => o.host <= 'node-40') } } as CephInventory : bigCluster() })
      expect(screen.queryByTestId('host-problem-toggle')).toBeNull()
    })

    it('is offered above 40 hosts and reports the change', () => {
      const onProblemOnlyChange = vi.fn()

      renderMap({ inventory: huge(), onProblemOnlyChange })
      fireEvent.click(screen.getByTestId('host-problem-toggle'))
      expect(onProblemOnlyChange).toHaveBeenCalledWith(true)
      expect(screen.getAllByTestId('host-row')).toHaveLength(45)
    })

    it('shows only problem hosts and says how many are hidden', () => {
      renderMap({ inventory: huge('node-07'), problemOnly: true })
      expect(screen.getAllByTestId('host-row')).toHaveLength(1)
      expect(screen.getByTestId('host-map')).toHaveTextContent('44 hosts hidden, all healthy')
    })

    it('says so when no host has a problem', () => {
      renderMap({ inventory: huge(), problemOnly: true })
      expect(screen.queryByTestId('host-row')).toBeNull()
      expect(screen.getByTestId('host-map-no-problem')).toHaveTextContent('No problem host')
    })

    it('sizes the columns from the content of a row and fills the width with auto-fit, the full host name in a title', () => {
      renderMap({ inventory: huge() })
      expect(screen.getByTestId('host-grid').style.gridTemplateColumns || getComputedStyle(screen.getByTestId('host-grid')).gridTemplateColumns).toMatch(/auto-fit/)
    })

    it('names carry their full text in a title, and the tags block clips instead of overlapping the squares', () => {
      const long = 'storage-node-with-a-very-long-fqdn-01.datacenter.example.internal'

      renderMap({ inventory: inventoryOf(Array.from({ length: 6 }, (_, i) => osd(i, long))) })
      expect(screen.getByText(long)).toHaveAttribute('title', long)
      const tags = screen.getByTestId('host-tags')

      expect(tags).toHaveStyle({ overflow: 'hidden', minWidth: '0px' })
      expect(tags.parentElement).toHaveStyle({ overflow: 'hidden' })
    })
  })
})
