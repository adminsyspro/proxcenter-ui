import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import ZoneSparkline from './ZoneSparkline'

afterEach(cleanup)

const FROM = Date.parse('2026-11-04T00:00:00Z')
const series = () => { const s = new Array<number>(24).fill(0); s[2] = 10; s[5] = 40; return s }
const bars = () => [...document.querySelectorAll('[data-bucket]')]

describe('ZoneSparkline', () => {
  it('draws one bar per hour, scaled on the peak, and says what an observed zone would block', () => {
    renderWithProviders(<ZoneSparkline state='observe' series={series()} from={FROM} stepMs={3_600_000} />)
    expect(screen.getByText('Uncovered · 24 h')).toBeTruthy()
    expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('50 would be blocked')
    expect(screen.getByRole('img', { name: 'Uncovered traffic over the last 24 hours: 50 hits' })).toBeTruthy()
    expect(bars()).toHaveLength(24)
    const height = (i: number) => Number(bars()[i].querySelectorAll('rect')[1].getAttribute('height'))
    expect(height(5)).toBe(24)
    expect(height(2)).toBe(6)
    expect(height(0)).toBe(1)
  })

  it('writes a large total in short, the exact count in its tooltip', async () => {
    renderWithProviders(<ZoneSparkline state='observe' series={[278_053, 0]} from={FROM} stepMs={3_600_000} />)
    const total = screen.getByTestId('zone-sparkline-total')
    expect(total.textContent).toBe('278.1K would be blocked')
    fireEvent.mouseOver(total)
    expect((await screen.findByRole('tooltip')).textContent).toBe('Uncovered traffic over the last 24 hours: 278,053 hits')
  })

  it('says what an enforced zone blocked', () => {
    renderWithProviders(<ZoneSparkline state='enforce' series={[1, 0]} from={FROM} stepMs={3_600_000} />)
    expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('1 blocked')
    expect(bars()).toHaveLength(2)
  })

  it('shows the hour and the count of a bar on hover', async () => {
    renderWithProviders(<ZoneSparkline state='observe' series={series()} from={FROM} stepMs={3_600_000} />)
    fireEvent.mouseOver(bars()[5])
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/to .*: 40 hits$/)
  })

  it('draws a flat track while the history is read', () => {
    renderWithProviders(<ZoneSparkline state='observe' series={null} from={FROM} stepMs={3_600_000} />)
    expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('Reading the history...')
    expect(bars()).toHaveLength(24)
  })

  it('says a disabled zone logs nothing and draws no bar', () => {
    renderWithProviders(<ZoneSparkline state='disabled' series={series()} from={FROM} stepMs={3_600_000} />)
    expect(screen.getByText('Zone disabled: its traffic is not logged')).toBeTruthy()
    expect(bars()).toHaveLength(0)
  })

  describe('by direction', () => {
    const out = () => { const s = new Array<number>(24).fill(0); s[5] = 20; return s }
    const hitsOf = (i: number) => [...bars()[i].querySelectorAll('rect')].slice(1).map(r => Number(r.getAttribute('height')))

    it('draws one series and no legend when no outbound traffic exists', () => {
      renderWithProviders(<ZoneSparkline state='observe' series={series()} outSeries={new Array<number>(24).fill(0)} from={FROM} stepMs={3_600_000} />)
      expect(screen.queryByTestId('zone-sparkline-legend')).toBeNull()
      expect(bars()[5].querySelectorAll('rect')).toHaveLength(2)
    })

    it('draws an inbound and an outbound series with a legend when outbound traffic exists', () => {
      renderWithProviders(<ZoneSparkline state='observe' series={series()} outSeries={out()} from={FROM} stepMs={3_600_000} />)
      const legend = screen.getByTestId('zone-sparkline-legend')
      expect(legend.textContent).toContain('Inbound')
      expect(legend.textContent).toContain('Outbound')
      expect(bars()[5].querySelectorAll('rect')).toHaveLength(3)
      expect(hitsOf(5)).toEqual([24, 12])
      expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('50 would be blocked · 20 outbound would be blocked')
    })

    it('says both counts on hover', async () => {
      renderWithProviders(<ZoneSparkline state='observe' series={series()} outSeries={out()} from={FROM} stepMs={3_600_000} />)
      fireEvent.mouseOver(bars()[5])
      expect((await screen.findByRole('tooltip')).textContent).toMatch(/: 40 hits inbound, 20 hits outbound$/)
    })

    it('words each side with its own state: inbound enforced and outbound observed, and the reverse', () => {
      const { unmount } = renderWithProviders(<ZoneSparkline state='enforce' outState='observe' series={series()} outSeries={out()} from={FROM} stepMs={3_600_000} />)
      expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('50 blocked · 20 outbound would be blocked')
      unmount()
      renderWithProviders(<ZoneSparkline state='observe' outState='enforce' series={series()} outSeries={out()} from={FROM} stepMs={3_600_000} />)
      expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('50 would be blocked · 20 outbound blocked')
    })

    it('says only the outbound part when nothing came in', () => {
      renderWithProviders(<ZoneSparkline state='enforce' outState='enforce' series={new Array<number>(24).fill(0)} outSeries={out()} from={FROM} stepMs={3_600_000} />)
      expect(screen.getByTestId('zone-sparkline-total').textContent).toBe('20 outbound blocked')
    })
  })
})
