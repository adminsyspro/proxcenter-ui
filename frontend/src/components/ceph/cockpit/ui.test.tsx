import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme, getContrastRatio } from '@mui/material/styles'
import type { ReactElement, ReactNode } from 'react'

import en from '@/messages/en.json'

import { SparkLines, Sparkline, StatTile, StateDot, ThresholdBar, SERIES_MIN_CONTRAST, SERIES_MIN_GAP, hueGap, hueOf, seriesColors, toneColor, uncleanColor } from './ui'

const theme = createTheme()

const Wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
    <ThemeProvider theme={theme}>{children}</ThemeProvider>
  </NextIntlClientProvider>
)

const renderUi = (ui: ReactElement) => render(ui, { wrapper: Wrapper })

afterEach(cleanup)

describe('ThresholdBar', () => {
  it('ThresholdBar draws markers at nearfull and full', () => {
    renderUi(<ThresholdBar value={82} max={100} nearfull={0.85} full={0.95} />)

    const markers = screen.getAllByTestId('threshold-marker')

    expect(markers).toHaveLength(2)
    expect(markers[0]).toHaveStyle({ left: '85%' })
    expect(markers[1]).toHaveStyle({ left: '95%' })
    expect(screen.getByTestId('threshold-fill')).toHaveStyle({ width: '82%' })
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '82')
  })

  it('colours the fill only past a threshold', () => {
    const { rerender } = renderUi(<ThresholdBar value={50} max={100} nearfull={0.85} full={0.95} />)
    const tone = () => screen.getByTestId('threshold-fill').getAttribute('data-tone')

    expect(tone()).toBe('neutral')
    rerender(<ThresholdBar value={88} max={100} nearfull={0.85} full={0.95} />)
    expect(tone()).toBe('warn')
    rerender(<ThresholdBar value={97} max={100} nearfull={0.85} full={0.95} />)
    expect(tone()).toBe('error')
  })

  it('clamps the fill and survives a zero max', () => {
    renderUi(<ThresholdBar value={5} max={0} nearfull={0.85} full={0.95} size='sm' />)

    expect(screen.getByTestId('threshold-fill')).toHaveStyle({ width: '0%' })
  })
})

describe('StatTile', () => {
  it('StatTile hides sparkline under 2 points', () => {
    const { unmount } = renderUi(<StatTile label='IOPS' value='105' series={[4]} tone='read' />)

    expect(screen.getByText('105')).toBeInTheDocument()
    expect(screen.queryByTestId('sparkline')).toBeNull()
    unmount()

    renderUi(<StatTile label='IOPS' value='105' series={[4, 9]} tone='read' />)
    expect(screen.getByTestId('sparkline')).toBeInTheDocument()
  })

  it('an empty tile says so instead of drawing a value or a curve', () => {
    renderUi(<StatTile label='Latency' value='1.3' series={[1, 2, 3]} empty />)

    expect(screen.queryByText('1.3')).toBeNull()
    expect(screen.queryByTestId('sparkline')).toBeNull()
    expect(screen.getByText(en.cephCockpit.ui.noData)).toBeInTheDocument()
  })
})

describe('Sparkline', () => {
  it('starts its scale at zero so a flat low series is not drawn as a peak', () => {
    renderUi(<Sparkline data={[10, 10, 10]} tone='neutral' />)

    const points = screen.getByTestId('sparkline').querySelector('polyline')?.getAttribute('points') ?? ''
    const ys = points.split(' ').map(p => Number(p.split(',')[1]))

    expect(new Set(ys).size).toBe(1)
    expect(ys[0]).toBeGreaterThan(0)
  })

  it('renders nothing under 2 points', () => {
    renderUi(<Sparkline data={[1]} tone='write' />)

    expect(screen.queryByTestId('sparkline')).toBeNull()
  })
})

describe('SparkLines', () => {
  // Read and write share one scale: a small write series must not be stretched to the read's height.
  it('draws several series on one shared scale', () => {
    renderUi(<SparkLines series={[{ data: [100, 100], tone: 'read' }, { data: [10, 10], tone: 'write' }]} />)

    const lines = [...screen.getByTestId('sparkline').querySelectorAll('polyline')]
    const y = (el: Element) => Number((el.getAttribute('points') ?? '').split(' ')[0].split(',')[1])

    expect(lines).toHaveLength(2)
    expect(y(lines[1])).toBeGreaterThan(y(lines[0]))
  })

  it('renders nothing when no series has 2 points', () => {
    renderUi(<SparkLines series={[{ data: [1], tone: 'read' }, { data: [], tone: 'write' }]} />)

    expect(screen.queryByTestId('sparkline')).toBeNull()
  })
})

describe('StateDot', () => {
  it('carries its state', () => {
    renderUi(<StateDot state='error' />)

    expect(screen.getByTestId('state-dot')).toHaveAttribute('data-state', 'error')
  })
})

describe('SparkLines interpolation', () => {
  it('joins the measured points with straight segments (a polyline, no smoothing)', () => {
    const { container } = render(
      <ThemeProvider theme={createTheme()}>
        <SparkLines series={[{ data: [1, 5, 2, 8], tone: 'read' }]} />
      </ThemeProvider>,
    )

    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(container.querySelector('path')).toBeNull()
  })
})

describe('series colours', () => {
  const PRIMARIES = ['#E57000', '#FFAB1D', '#F59E0B', '#FDE047', '#1E1B4B', '#2563EB', '#7C3AED']
  const MODES = ['light', 'dark'] as const
  const themeOf = (main: string, mode: 'light' | 'dark') => createTheme({ palette: { mode, primary: { main } } })
  const cases = PRIMARIES.flatMap(main => MODES.map(mode => ({ main, mode, theme: themeOf(main, mode) })))

  it.each(cases)('$main $mode: every series holds 3:1 on the card surface', ({ theme }) => {
    for (const tone of ['read', 'write', 'recovery'] as const) {
      expect(getContrastRatio(toneColor(theme, tone), theme.palette.background.paper), tone).toBeGreaterThanOrEqual(SERIES_MIN_CONTRAST)
    }
  })

  it.each(cases)('$main $mode: write is apart from read, recovery from both, three distinct colours', ({ theme }) => {
    const { read, write, recovery } = seriesColors(theme)

    expect(getContrastRatio(read, write)).toBeGreaterThanOrEqual(SERIES_MIN_GAP)
    expect(getContrastRatio(recovery, read)).toBeGreaterThan(1.2)
    expect(getContrastRatio(recovery, write)).toBeGreaterThan(1.2)
    expect(new Set([read, write, recovery]).size).toBe(3)
  })

  it.each(cases)('$main $mode: the unclean PGs are told apart from the read series by hue', ({ theme }) => {
    const unclean = uncleanColor(theme)
    const read = toneColor(theme, 'read')

    expect(unclean).not.toBe(read)
    expect(hueGap(hueOf(unclean), hueOf(read))).toBeGreaterThanOrEqual(20)
  })

  it('keeps the warning colour when the primary is far from its hue, the error one when it is close', () => {
    const blue = themeOf('#2563EB', 'light')
    const orange = themeOf('#E57000', 'light')

    expect(uncleanColor(blue)).toBe(blue.palette.warning.main)
    expect(uncleanColor(orange)).toBe(orange.palette.error.main)
  })

  it('follows the theme: two presets give different series', () => {
    const orange = themeOf('#E57000', 'light')
    const violet = themeOf('#7C3AED', 'light')

    for (const tone of ['read', 'write', 'recovery'] as const) expect(toneColor(orange, tone)).not.toBe(toneColor(violet, tone))
  })

  it('leaves states out of the primary colour', () => {
    const t = themeOf('#E57000', 'light')

    expect(toneColor(t, 'warning')).toBe(t.palette.warning.main)
  })
})
