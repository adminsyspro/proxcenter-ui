import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import PeriodToggle from './PeriodToggle'

afterEach(cleanup)

describe('PeriodToggle', () => {
  it('enables every period and reports a change', async () => {
    const onChange = vi.fn()

    renderWithProviders(<PeriodToggle value="24h" onChange={onChange} />)

    for (const name of ['1h', '24h', '7d', '30d']) expect(screen.getByRole('button', { name })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(onChange).toHaveBeenCalledWith('7d')
  })
})
