import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import ChartSeriesToggles, { useHiddenSeries } from './ChartSeriesToggles'

const series = [
  { key: 'diskReadBps', label: 'Read', color: '#ef4444' },
  { key: 'diskWriteBps', label: 'Write', color: '#fca5a5' },
  { key: 'lat_scsi0', label: 'scsi0', color: '#f59e0b' },
]

afterEach(cleanup)

describe('ChartSeriesToggles (#1011)', () => {
  it('renders the chart title and one pressed toggle per visible series', () => {
    renderWithProviders(<ChartSeriesToggles title="Disk I/O" series={series} hidden={new Set(['lat_scsi0'])} onToggle={() => {}} />)

    expect(screen.getByText('Disk I/O')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Write' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'scsi0' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the key of the toggle that was clicked', () => {
    const onToggle = vi.fn()

    renderWithProviders(<ChartSeriesToggles title="Disk I/O" series={series} hidden={new Set()} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    fireEvent.click(screen.getByRole('button', { name: 'scsi0' }))

    expect(onToggle.mock.calls).toEqual([['diskWriteBps'], ['lat_scsi0']])
  })
})

describe('useHiddenSeries', () => {
  it('starts with nothing hidden and toggles a key in and out', () => {
    const { result } = renderHook(() => useHiddenSeries())

    expect(result.current[0].size).toBe(0)
    act(() => result.current[1]('diskWriteBps'))
    expect([...result.current[0]]).toEqual(['diskWriteBps'])
    act(() => result.current[1]('lat_scsi0'))
    expect([...result.current[0]]).toEqual(['diskWriteBps', 'lat_scsi0'])
    act(() => result.current[1]('diskWriteBps'))
    expect([...result.current[0]]).toEqual(['lat_scsi0'])
  })
})
