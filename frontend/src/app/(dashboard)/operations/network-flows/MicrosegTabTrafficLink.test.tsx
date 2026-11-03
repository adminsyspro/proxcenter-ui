/**
 * The Overview of the Micro-segmentation tab links to the Network flows page grouped by zone, for its connection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'

import { screen } from '@/__tests__/setup/renderWithProviders'
import { renderTab, resetMocks } from '@/app/(dashboard)/automation/network/components/microseg/microsegTestKit'

beforeEach(resetMocks)
afterEach(cleanup)

describe('MicrosegTab Traffic by zone link', () => {
  it('opens the Network flows page grouped by zone on the Overview only', async () => {
    renderTab()
    const link = await screen.findByRole('link', { name: 'Traffic by zone' })
    expect(link).toHaveAttribute('href', '/operations/network-flows?groupBy=zone&connection=c1')

    fireEvent.click(screen.getByRole('tab', { name: 'Policy' }))
    expect(screen.queryByRole('link', { name: 'Traffic by zone' })).not.toBeInTheDocument()
  })
})
