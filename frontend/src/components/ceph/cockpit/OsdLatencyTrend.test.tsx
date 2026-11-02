import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'

import { Sparkline } from './ui'
import OsdLatencyTrend, { latencyWindow } from './OsdLatencyTrend'

const pt = (avg: number, max = avg) => ({ time: 0, avg, max })

function renderTrend(points: Parameters<typeof OsdLatencyTrend>[0]['points'], session = false) {
  return render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={createTheme()}>
        <OsdLatencyTrend points={points} session={session} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

afterEach(cleanup)

describe('OsdLatencyTrend', () => {
  it('computes min / mean / max of the window', () => {
    expect(latencyWindow([pt(2, 5), pt(4, 9), pt(6, 7)])).toEqual({ min: 2, avg: 4, max: 9 })
  })

  it('under 2 points: the discreet collecting text, no curve', () => {
    renderTrend(undefined)
    expect(screen.getByTestId('osd-trend-collecting')).toHaveTextContent('collecting…')
    cleanup()
    renderTrend([pt(3)])
    expect(screen.getByTestId('osd-trend-collecting')).toBeTruthy()
    expect(screen.queryByTestId('sparkline')).toBeNull()
  })

  it('draws a 64 x 18 curve with the window in its label', () => {
    renderTrend([pt(2, 5), pt(4, 9), pt(6, 7)])
    const el = screen.getByTestId('osd-trend')

    expect(screen.getByTestId('sparkline')).toBeTruthy()
    expect(el).toHaveStyle({ width: '64px', height: '18px' })
    expect(el).toHaveAttribute('aria-label', '2 / 4 / 9 ms (lowest average / mean / worst value observed, over the period)')
    expect(el).toHaveAttribute('data-slow', 'false')
  })

  it('says it is the session curve when it is', () => {
    renderTrend([pt(1), pt(2)], true)
    expect(screen.getByTestId('osd-trend').getAttribute('aria-label')).toContain('since this page was opened')
  })

  it('turns orange when the last value reaches the slow OSD floor', () => {
    renderTrend([pt(1), pt(10)])
    expect(screen.getByTestId('osd-trend')).toHaveAttribute('data-slow', 'true')
    cleanup()
    renderTrend([pt(30), pt(9.9)])
    expect(screen.getByTestId('osd-trend')).toHaveAttribute('data-slow', 'false')
  })

  describe('scale', () => {
    const ys = (container: HTMLElement) => (container.querySelector('polyline')?.getAttribute('points') ?? '').split(' ').map(p => Number(p.split(',')[1]))
    const spread = (v: number[]) => (Math.max(...v) - Math.min(...v)) / 18

    it('a 0 to 1 ms swing stays small: the axis spans at least the slow OSD floor, anchored at 0', () => {
      const { container } = renderTrend([pt(0), pt(1), pt(0), pt(1)])

      expect(spread(ys(container))).toBeLessThan(0.1)
    })

    it('without a floor the same swing fills the height (the other sparklines are unchanged)', () => {
      const { container } = render(<ThemeProvider theme={createTheme()}><Sparkline data={[0, 1, 0, 1]} tone='neutral' height={18} /></ThemeProvider>)

      expect(spread(ys(container))).toBeGreaterThan(0.7)
    })

    it('a real rise above the floor still uses the height', () => {
      const { container } = renderTrend([pt(0), pt(40), pt(0), pt(40)])

      expect(spread(ys(container))).toBeGreaterThan(0.7)
    })
  })
})
