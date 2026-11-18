/**
 * SeenPeriodPicker: the button of the map toolbar that says how far back the observed flows drawn go ("any time" by
 * default: the map holds every pending flow since it was first seen), and its four choices.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, within } from '@/__tests__/setup/renderWithProviders'

import SeenPeriodPicker from './SeenPeriodPicker'

afterEach(cleanup)

describe('SeenPeriodPicker', () => {
  it('says the period on its button and lists the four of them, the current one ticked', () => {
    renderWithProviders(<SeenPeriodPicker period='all' onPeriod={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seen: any time' }))
    const menu = screen.getByRole('menu', { name: 'Observed flows seen' })
    expect(within(menu).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['last hour', 'last 24 hours', 'last 7 days', 'any time'])
    expect((within(menu).getByRole('radio', { name: 'any time' }) as HTMLInputElement).checked).toBe(true)
    expect(within(menu).getByText('The hits of a flow are its total since it was first seen, whatever the period.')).toBeTruthy()
  })

  it('picks a period and closes', () => {
    const onPeriod = vi.fn()
    renderWithProviders(<SeenPeriodPicker period='24h' onPeriod={onPeriod} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seen: last 24 hours' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Observed flows seen' })).getByText('last hour'))
    expect(onPeriod).toHaveBeenCalledWith('1h')
  })
})
