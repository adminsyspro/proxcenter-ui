/**
 * Component tests for FrequencyPicker's numeric hour fields (discussion #634).
 *
 * The three hourly-mode fields used to clamp inside onChange
 * (`Math.max(1, Math.min(24, Number(v) || 1))`), which made them impossible to
 * clear: deleting the last digit wrote the bound straight back into state. The
 * clamp now lives on blur, so the tests drive a real parent and check both the
 * intermediate (empty) display state and the committed spec.
 */

import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import FrequencyPicker from './FrequencyPicker'
import { ALLOWED_INTERVAL_MINUTES, type ScheduleSpec } from './types'

afterEach(cleanup)

function Harness({ initial }: { initial: ScheduleSpec }) {
  const [value, setValue] = useState<ScheduleSpec>(initial)

  return (
    <>
      <FrequencyPicker value={value} onChange={setValue} />
      <span data-testid="spec">{JSON.stringify(value)}</span>
      <button type="button">elsewhere</button>
    </>
  )
}

const hourly = (everyHours = 2): ScheduleSpec => ({ mode: 'hourly', everyHours })

const spec = () => JSON.parse(screen.getByTestId('spec').textContent as string)
const everyHours = () => screen.getByRole('spinbutton') as HTMLInputElement
const hourField = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const blur = () => userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))

// The hour window is opt-in; enabling it seeds windowStart=20 / windowEnd=6.
async function enableWindow() {
  await userEvent.click(screen.getByRole('checkbox'))
}

describe('FrequencyPicker interval mode', () => {
  it('selecting Interval yields a valid interval spec', async () => {
    renderWithProviders(<Harness initial={hourly()} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Interval' }))

    expect(spec()).toEqual({ mode: 'interval', everyMinutes: 30 })
  })

  it('offers exactly the allowed interval values', async () => {
    renderWithProviders(<Harness initial={{ mode: 'interval', everyMinutes: 30 }} />)

    await userEvent.click(screen.getByRole('combobox'))
    const offeredValues = screen.getAllByRole('option').map(option => Number(option.getAttribute('data-value')))

    expect(offeredValues).toEqual([...ALLOWED_INTERVAL_MINUTES])
  })
})

describe('FrequencyPicker numeric fields', () => {
  it('shows the interval it is given', () => {
    renderWithProviders(<Harness initial={hourly(6)} />)
    expect(everyHours().value).toBe('6')
  })

  it('lets the interval be cleared without snapping back to 1', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await userEvent.clear(everyHours())
    expect(everyHours().value).toBe('')
    // The parent still owns the last good number; only the display is empty.
    expect(spec().everyHours).toBe(2)
  })

  it('replaces the interval instead of gluing the old digit in front', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await userEvent.clear(everyHours())
    await userEvent.type(everyHours(), '12')
    expect(everyHours().value).toBe('12')
    expect(spec().everyHours).toBe(12)
  })

  it('clamps the interval to 24 on blur, not while typing', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await userEvent.clear(everyHours())
    await userEvent.type(everyHours(), '99')
    expect(everyHours().value).toBe('99')
    await blur()
    expect(everyHours().value).toBe('24')
    expect(spec().everyHours).toBe(24)
  })

  it('clamps the interval up to 1 on blur', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await userEvent.clear(everyHours())
    await userEvent.type(everyHours(), '0')
    await blur()
    expect(spec().everyHours).toBe(1)
  })

  it('commits the fallback of 1 when the interval is left empty', async () => {
    renderWithProviders(<Harness initial={hourly(6)} />)
    await userEvent.clear(everyHours())
    await blur()
    expect(everyHours().value).toBe('1')
    expect(spec().everyHours).toBe(1)
  })

  it('lets the start hour be cleared and retyped', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await enableWindow()
    expect(hourField('Start hour').value).toBe('20')

    await userEvent.clear(hourField('Start hour'))
    expect(hourField('Start hour').value).toBe('')
    expect(spec().windowStart).toBe(20)

    await userEvent.type(hourField('Start hour'), '7')
    expect(spec().windowStart).toBe(7)
    // The sibling field must not have been disturbed.
    expect(spec().windowEnd).toBe(6)
  })

  it('clamps the end hour to 23 on blur', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await enableWindow()
    await userEvent.clear(hourField('End hour'))
    await userEvent.type(hourField('End hour'), '48')
    await blur()
    expect(hourField('End hour').value).toBe('23')
    expect(spec().windowEnd).toBe(23)
  })

  it('commits the fallback of 0 when an hour bound is left empty', async () => {
    renderWithProviders(<Harness initial={hourly(2)} />)
    await enableWindow()
    await userEvent.clear(hourField('Start hour'))
    await blur()
    expect(hourField('Start hour').value).toBe('0')
    expect(spec().windowStart).toBe(0)
  })
})
