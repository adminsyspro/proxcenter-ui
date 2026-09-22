import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

afterEach(cleanup)

import UsageBar from './UsageBar'

const GIB = 1024 ** 3

const base = {
  themeColor: '#1976d2',
  label: 'RAM usage',
  used: 87 * GIB,
  capacity: 128 * GIB,
  mode: 'bytes' as const,
}

describe('UsageBar provisioning marker (#969)', () => {
  it('places the marker at the provisioned share of the bar', () => {
    renderWithProviders(<UsageBar {...base} marker={{ pct: 75, label: '96 GiB provisioned' }} />)

    expect(screen.getByTestId('usage-bar-marker')).toHaveStyle({ left: '75%' })
    expect(screen.queryByTestId('usage-bar-overflow')).not.toBeInTheDocument()
  })

  it('pins the marker to the end of the bar and flags the overflow past capacity', () => {
    renderWithProviders(<UsageBar {...base} marker={{ pct: 150, label: '192 GiB provisioned' }} />)

    expect(screen.getByTestId('usage-bar-marker')).toHaveStyle({ left: '100%' })
    expect(screen.getByTestId('usage-bar-overflow')).toBeInTheDocument()
  })

  it('tops the marker with an arrow, so a 2px rule is not the only thing to aim at', () => {
    renderWithProviders(<UsageBar {...base} marker={{ pct: 75, label: '96 GiB provisioned' }} />)

    expect(screen.getByTestId('usage-bar-marker-arrow')).toBeInTheDocument()
  })

  it('hangs the marker outside the track, which clips its own children', () => {
    // Drawn inside, the arrow could only ever sit within the 14px of the bar.
    // Outside, it stands above it with its tip on the edge.
    renderWithProviders(<UsageBar {...base} marker={{ pct: 75, label: '96 GiB provisioned' }} />)

    const track = screen.getByTestId('usage-bar-track')

    expect(track).not.toContainElement(screen.getByTestId('usage-bar-marker'))
  })

  it('puts the arrow above the rule, not below it', () => {
    renderWithProviders(<UsageBar {...base} marker={{ pct: 75, label: '96 GiB provisioned' }} />)

    const marker = screen.getByTestId('usage-bar-marker')

    expect(marker.firstElementChild).toBe(screen.getByTestId('usage-bar-marker-arrow'))
  })

  it('names the marker so the figure is not colour-only', () => {
    renderWithProviders(<UsageBar {...base} marker={{ pct: 75, label: '96 GiB provisioned' }} />)

    expect(screen.getByLabelText('96 GiB provisioned')).toBeInTheDocument()
  })

  it('opens the marker tooltip on hover', async () => {
    renderWithProviders(
      <UsageBar {...base} marker={{ pct: 75, label: '96 GiB provisioned', tooltip: <span>Running 96 GiB</span> }} />
    )

    await userEvent.hover(screen.getByTestId('usage-bar-marker'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Running 96 GiB')
  })

  it('marks the percent gauge too, so the CPU bar behaves like the memory one', () => {
    renderWithProviders(
      <UsageBar themeColor="#1976d2" label="CPU usage" used={42} capacity={100} mode="pct" marker={{ pct: 60, label: '24 vCPU' }} />
    )

    expect(screen.getByTestId('usage-bar-marker')).toHaveStyle({ left: '60%' })
  })

  it('draws no marker when none is given, so the other gauges are unchanged', () => {
    renderWithProviders(<UsageBar themeColor="#1976d2" label="SWAP usage" used={1 * GIB} capacity={8 * GIB} mode="bytes" />)

    expect(screen.queryByTestId('usage-bar-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('usage-bar-overflow')).not.toBeInTheDocument()
  })
})
