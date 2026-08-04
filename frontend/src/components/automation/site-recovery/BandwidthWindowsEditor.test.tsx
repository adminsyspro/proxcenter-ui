/**
 * Component tests for the per-row rate field of BandwidthWindowsEditor
 * (discussion #634).
 *
 * The rate used to be coerced with `Math.max(0, Number(v) || 0)` inside
 * onChange, so deleting the last digit wrote 0 straight back and the old digit
 * stayed glued in front of whatever was typed next. The field is now buffered
 * and the bound applies on blur.
 *
 * Because the field lives inside a list, the tests also pin the two list-specific
 * hazards: each input must stay bound to its own row index, and editing one row
 * must not remount (and therefore wipe) a sibling row's input.
 */

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { BandwidthWindow } from '@/lib/orchestrator/site-recovery.types'

import BandwidthWindowsEditor from './BandwidthWindowsEditor'

afterEach(cleanup)

function windowAt(rate: number, start = 8, end = 18): BandwidthWindow {
  return { days: [1, 2, 3, 4, 5], start_hour: start, end_hour: end, rate_limit_mbps: rate }
}

function Harness({ initial }: { initial: BandwidthWindow[] }) {
  const [value, setValue] = useState<BandwidthWindow[]>(initial)

  return (
    <>
      <BandwidthWindowsEditor value={value} onChange={setValue} staticRateMbps={100} />
      <span data-testid="windows">{JSON.stringify(value.map(w => w.rate_limit_mbps))}</span>
      <button type="button">elsewhere</button>
    </>
  )
}

const rates = () => JSON.parse(screen.getByTestId('windows').textContent as string) as number[]
const rateInputs = () => screen.getAllByRole('spinbutton') as HTMLInputElement[]
const blur = () => userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))

describe('BandwidthWindowsEditor rate field', () => {
  it('shows the rate of each window', () => {
    renderWithProviders(<Harness initial={[windowAt(50), windowAt(20)]} />)
    expect(rateInputs().map(i => i.value)).toEqual(['50', '20'])
  })

  it('lets the rate be cleared without snapping back to 0', async () => {
    renderWithProviders(<Harness initial={[windowAt(50)]} />)
    await userEvent.clear(rateInputs()[0])
    expect(rateInputs()[0].value).toBe('')
    // The row still holds the last good number; only the display is empty.
    expect(rates()).toEqual([50])
  })

  it('replaces the rate instead of gluing the old digit in front', async () => {
    renderWithProviders(<Harness initial={[windowAt(50)]} />)
    await userEvent.clear(rateInputs()[0])
    await userEvent.type(rateInputs()[0], '10')
    expect(rateInputs()[0].value).toBe('10')
    expect(rates()).toEqual([10])
  })

  it('commits 0 (unlimited) when the rate is left empty', async () => {
    renderWithProviders(<Harness initial={[windowAt(50)]} />)
    await userEvent.clear(rateInputs()[0])
    await blur()
    expect(rateInputs()[0].value).toBe('0')
    expect(rates()).toEqual([0])
    expect(screen.getByText(/unlimited/)).toBeInTheDocument()
  })

  it('keeps each input bound to its own row and leaves siblings untouched', async () => {
    renderWithProviders(<Harness initial={[windowAt(50), windowAt(20), windowAt(5)]} />)

    await userEvent.clear(rateInputs()[1])
    await userEvent.type(rateInputs()[1], '75')

    expect(rates()).toEqual([50, 75, 5])
    // Editing row 1 must not remount rows 0 and 2 (that would drop their buffer).
    expect(rateInputs().map(i => i.value)).toEqual(['50', '75', '5'])
  })

  it('does not lose a half-typed buffer when a sibling row re-renders', async () => {
    renderWithProviders(<Harness initial={[windowAt(50), windowAt(20)]} />)

    // Empty row 0 without committing, then change row 1 through the DOM so the
    // parent rebuilds the array while focus never leaves row 0. Row 0 must keep
    // its empty buffer: a remount (bad keying) would repaint it with '50'.
    await userEvent.clear(rateInputs()[0])
    fireEvent.change(rateInputs()[1], { target: { value: '30' } })

    expect(rateInputs()[0].value).toBe('')
    expect(rates()).toEqual([50, 30])
  })
})
