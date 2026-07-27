import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import HaTab from './HaTab'

const useLicenseMock = vi.fn()
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => useLicenseMock(),
  Features: { HA: 'control_plane_ha' },
}))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))

const useHaConfigMock = vi.fn()
vi.mock('./useHaConfig', () => ({
  useHaConfig: () => useHaConfigMock(),
}))

vi.mock('./HaDeployWizard', () => ({
  default: () => <div data-testid='ha-deploy-wizard' />,
}))

vi.mock('./HaClusterDashboard', () => ({
  default: () => <div data-testid='ha-cluster-dashboard' />,
}))

describe('HaTab', () => {
  beforeEach(() => {
    useLicenseMock.mockReset()
    useHaConfigMock.mockReset()
  })
  afterEach(() => cleanup())

  it('renders the deploy wizard when the capability is granted and HA is not deployed', async () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => true, loading: false })
    useHaConfigMock.mockReturnValue({ data: undefined, isLoading: false, mutate: vi.fn() })

    render(<HaTab />)

    expect(await screen.findByTestId('ha-deploy-wizard')).toBeInTheDocument()
    expect(screen.queryByTestId('ha-cluster-dashboard')).not.toBeInTheDocument()
  })

  it('renders the cluster dashboard when the capability is granted and HA is deployed', async () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => true, loading: false })
    useHaConfigMock.mockReturnValue({
      data: { enabled: true, deploymentState: 'deployed' },
      isLoading: false,
      mutate: vi.fn(),
    })

    render(<HaTab />)

    expect(await screen.findByTestId('ha-cluster-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('ha-deploy-wizard')).not.toBeInTheDocument()
  })

  it('renders the add-on upsell when the capability is denied', () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: false })
    useHaConfigMock.mockReturnValue({ data: undefined, isLoading: false, mutate: vi.fn() })

    render(<HaTab />)

    expect(screen.getByText('license.optionRestricted')).toBeInTheDocument()
    expect(screen.queryByTestId('ha-deploy-wizard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ha-cluster-dashboard')).not.toBeInTheDocument()
  })

  it('renders neither the wizard/dashboard nor the upsell while the license is loading', () => {
    useLicenseMock.mockReturnValue({ hasFeature: () => false, loading: true })
    useHaConfigMock.mockReturnValue({ data: undefined, isLoading: false, mutate: vi.fn() })

    render(<HaTab />)

    expect(screen.queryByText('license.optionRestricted')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ha-deploy-wizard')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ha-cluster-dashboard')).not.toBeInTheDocument()
  })
})
