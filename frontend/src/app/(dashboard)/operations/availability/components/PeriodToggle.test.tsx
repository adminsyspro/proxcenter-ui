import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import PeriodToggle from './PeriodToggle'

afterEach(cleanup)

describe('PeriodToggle', () => {
  it('enables every period and reports a change', async () => {
    const onChange = vi.fn()

    renderWithProviders(<PeriodToggle value="24h" onChange={onChange} />)

    for (const name of ['1h', '24h', '7d', '30d', '1y']) expect(screen.getByRole('button', { name })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(onChange).toHaveBeenCalledWith('7d')
  })

  it('applies a range picked by hand and refuses one upside down', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<PeriodToggle value='24h' onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Custom' }))

    const from = screen.getByLabelText('From')
    const to = screen.getByLabelText('To')

    fireEvent.change(from, { target: { value: '2026-10-25T10:00' } })
    fireEvent.change(to, { target: { value: '2026-10-24T10:00' } })
    expect(screen.getByText('The end must come after the start.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    fireEvent.change(to, { target: { value: '2026-10-26T18:30' } })
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onChange).toHaveBeenCalledWith({ from: new Date('2026-10-25T10:00').toISOString(), to: new Date('2026-10-26T18:30').toISOString() })
  })

  it('names the range in use on its button', () => {
    renderWithProviders(<PeriodToggle value={{ from: '2026-10-25T10:00:00.000Z', to: '2026-10-26T18:30:00.000Z' }} onChange={() => {}} />)

    expect(screen.getByRole('button', { name: /Oct 25, 2026.*→.*Oct 26, 2026/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
