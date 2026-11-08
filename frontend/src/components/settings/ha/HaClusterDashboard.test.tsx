import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import HaClusterDashboard from './HaClusterDashboard'

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

const useHaClusterMock = vi.fn()
vi.mock('./useHaCluster', () => ({ useHaCluster: () => useHaClusterMock() }))
vi.mock('./useHaConfig', () => ({
  useHaConfig: () => ({ data: { deploymentState: 'deployed', securityLevel: 0, nodes: [] }, mutate: vi.fn() }),
}))
vi.mock('./HaSecurityUpgrade', () => ({ default: () => <div data-testid='ha-security-upgrade' /> }))

afterEach(() => cleanup())

describe('HaClusterDashboard', () => {
  // Mid-upgrade, /ha/cluster fails for a while (switchover, recreates): the
  // upgrade progress and its resume banner must stay visible.
  it('keeps the security upgrade visible when the cluster status cannot be loaded', () => {
    useHaClusterMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('502'), mutate: vi.fn() })

    render(<HaClusterDashboard />)

    expect(screen.getByText(/dashboard.loadFailed/)).toBeInTheDocument()
    expect(screen.getByTestId('ha-security-upgrade')).toBeInTheDocument()
  })
})
