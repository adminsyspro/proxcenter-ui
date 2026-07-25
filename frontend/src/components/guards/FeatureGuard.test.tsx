import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import FeatureGuard from './FeatureGuard'

const useLicenseMock = vi.fn()
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => useLicenseMock(),
  Features: { AUTO_HA: 'auto_ha' },
}))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))

describe('FeatureGuard', () => {
  beforeEach(() => useLicenseMock.mockReset())
  afterEach(() => cleanup())

  it('renders children when the feature is granted', () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => true, loading: false })
    render(<FeatureGuard feature='auto_ha'><div data-testid='inner' /></FeatureGuard>)
    expect(screen.getByTestId('inner')).toBeInTheDocument()
  })

  it('renders the add-on upsell when denied', () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: false })
    render(<FeatureGuard feature='auto_ha'><div data-testid='inner' /></FeatureGuard>)
    expect(screen.queryByTestId('inner')).not.toBeInTheDocument()
    expect(screen.getByText('license.optionRestricted')).toBeInTheDocument()
    expect(screen.getByText('license.addonChip')).toBeInTheDocument()
  })

  it('renders nothing but a loader while license loads', () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: true })
    render(<FeatureGuard feature='auto_ha'><div data-testid='inner' /></FeatureGuard>)
    expect(screen.queryByTestId('inner')).not.toBeInTheDocument()
    expect(screen.queryByText('license.optionRestricted')).not.toBeInTheDocument()
  })
})
