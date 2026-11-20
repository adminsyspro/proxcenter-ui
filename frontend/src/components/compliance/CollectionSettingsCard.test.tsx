import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
}))

import CollectionSettingsCard from './CollectionSettingsCard'

afterEach(cleanup)

describe('CollectionSettingsCard', () => {
  it('shows the defaults when the policies carry no value yet', () => {
    render(<CollectionSettingsCard cacheMinutes={undefined} guestConcurrency={undefined} onChange={vi.fn()} />)

    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByText('cacheMinutesValue:{"minutes":5}')).toBeInTheDocument()
    expect(screen.getByLabelText('guestConcurrency')).toHaveValue(4)
    // The helper says what the setting means for Proxmox VE: 3 requests per guest.
    expect(screen.getByText('guestConcurrencyHelper:{"requests":12}')).toBeInTheDocument()
  })

  it('offers every cache duration, 0 reading as never', () => {
    const onChange = vi.fn()
    render(<CollectionSettingsCard cacheMinutes={5} guestConcurrency={4} onChange={onChange} />)

    fireEvent.mouseDown(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual([
      'cacheNever',
      'cacheMinutesValue:{"minutes":1}',
      'cacheMinutesValue:{"minutes":5}',
      'cacheMinutesValue:{"minutes":15}',
      'cacheMinutesValue:{"minutes":30}',
    ])

    fireEvent.click(screen.getByRole('option', { name: 'cacheNever' }))
    expect(onChange).toHaveBeenCalledWith('compliance_cache_minutes', 0)
  })

  it('hands the guest count to the form', () => {
    const onChange = vi.fn()
    render(<CollectionSettingsCard cacheMinutes={5} guestConcurrency={4} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('guestConcurrency'), { target: { value: '2' } })

    expect(onChange).toHaveBeenCalledWith('compliance_guest_concurrency', 2)
  })
})
