import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import { slotEnd, stateRun, useAvailabilityFormat } from './availabilityFormat'
import { makeResult } from './fixtures'

afterEach(cleanup)

function Rate({ value }: { value: number }) {
  const { rate } = useAvailabilityFormat()

  return <span data-testid='rate'>{rate(value)}</span>
}

describe('useAvailabilityFormat().rate', () => {
  it.each([
    [99.999, '99.99%'],
    [0.29, '0.29%'],
    [0.57, '0.57%'],
    [100, '100%'],
  ])('shows %s as %s', (value, text) => {
    renderWithProviders(<Rate value={value} />)

    expect(screen.getByTestId('rate')).toHaveTextContent(text)
  })

  it('never loses a hundredth on a two-decimal value', () => {
    const lost: number[] = []

    for (let i = 0; i <= 10000; i++) {
      const value = i / 100

      if (Math.floor(value * 100 + 1e-9) / 100 !== value) lost.push(value)
    }

    expect(lost).toEqual([])
  })
})

describe('slotEnd', () => {
  const slots = makeResult('pve1', ['up', 'down', 'up']).slots

  it('ends a slot where the next one starts', () => {
    expect(slotEnd(slots, slots[0])).toBe(slots[1].start)
  })

  it('ends the last slot one slot length later', () => {
    expect(slotEnd(slots, slots[2])).toBe('2026-10-27T10:03:00.000Z')
  })

  it('never ends the last slot after the end of the window', () => {
    expect(slotEnd(slots, slots[2], '2026-10-27T10:02:30.000Z')).toBe('2026-10-27T10:02:30.000Z')
    expect(slotEnd(slots, slots[2], '2026-10-27T11:00:00.000Z')).toBe('2026-10-27T10:03:00.000Z')
  })
})

describe('stateRun', () => {
  const slots = makeResult('pve1', ['up', 'down', 'down', 'down', 'up', 'up']).slots

  it('spans every neighbouring slot in the same state', () => {
    expect(stateRun(slots, slots[2])).toEqual({ state: 'down', start: slots[1].start, end: slots[4].start })
  })

  it('stops at the edges of the window', () => {
    expect(stateRun(slots, slots[0])).toEqual({ state: 'up', start: slots[0].start, end: slots[1].start })
    expect(stateRun(slots, slots[5], '2026-10-27T10:05:30.000Z')).toEqual({ state: 'up', start: slots[4].start, end: '2026-10-27T10:05:30.000Z' })
  })
})
