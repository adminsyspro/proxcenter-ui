import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import RiskAcceptanceNote from './RiskAcceptanceNote'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => `${key} ${JSON.stringify(values)}`,
}))

afterEach(cleanup)

const acceptance = { justification: 'Handled by the host firewall', acceptedBy: 'admin@example.test', acceptedAt: '2026-11-25T10:00:00.000Z', expiresAt: null as string | null }

describe('RiskAcceptanceNote', () => {
  it('says who accepted the risk, when and why', () => {
    render(<RiskAcceptanceNote acceptance={acceptance} />)
    expect(screen.getByText(/^acceptedBy /)).toHaveTextContent('admin@example.test')
    expect(screen.getByText('Handled by the host firewall')).toBeInTheDocument()
  })

  it('adds the expiry day when the acceptance has one', () => {
    render(<RiskAcceptanceNote acceptance={{ ...acceptance, expiresAt: '2027-02-23T22:59:59.000Z' }} />)
    expect(screen.getByText(/^acceptedByUntil /)).toHaveTextContent(new Date('2027-02-23T22:59:59.000Z').toLocaleDateString())
  })
})
