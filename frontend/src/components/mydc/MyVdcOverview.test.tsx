/**
 * Component tests for MyVdcOverview.tsx: per-tier storage usage bars (Task 16).
 *
 * A vDC's `storagePolicies` (Tasks 7/14) carry an optional `quotaMb`. Any
 * policy with a non-null quota gets its own usage bar, keyed against
 * `usage.usedStorageByStorage[storageId]` (absent means 0 used so far).
 * Policies with no quota share the global storage donut above and get no bar.
 *
 * The heavy sibling cards (per-VM metrics charts, DC map, green-IT) all do
 * their own fetches and are mocked out here so this test stays isolated to
 * the new quota-tier block; QuotaDonut has no side effects and is left real.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

// The 7 quota donuts above are CircularProgress, which also carries
// role="progressbar", so scope down to the new LinearProgress tier bar.
function tierBar(): HTMLElement {
  const bar = screen.getAllByRole('progressbar').find(el => el.className.includes('MuiLinearProgress'))

  if (!bar) throw new Error('No LinearProgress tier bar found')

  return bar
}

vi.mock('./MyVmsMetricsCharts', () => ({ default: () => null }))
vi.mock('./MyDatacentersMapCard', () => ({ default: () => null }))
vi.mock('./MyGreenCard', () => ({ default: () => null }))

import MyVdcOverview from './MyVdcOverview'

function makeVdc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vdc-1',
    connectionId: 'conn-1',
    quota: {
      maxVcpus: null,
      maxRamMb: null,
      maxStorageMb: null,
      maxVms: null,
      maxSnapshots: null,
      maxBackups: null,
      maxVnets: null,
    },
    usage: {
      usedVcpus: 0,
      usedRamMb: 0,
      usedStorageMb: 0,
      usedVms: 0,
      usedSnapshots: 0,
      usedBackups: 0,
    },
    vnets: [],
    storagePolicies: [],
    ...overrides,
  }
}

describe('MyVdcOverview, per-tier storage usage bars', () => {
  afterEach(cleanup)

  it('renders no tier section when no policy carries a quota', () => {
    renderWithProviders(<MyVdcOverview vdc={makeVdc()} />)

    expect(screen.queryByText('Storage tiers')).not.toBeInTheDocument()
  })

  it('renders one bar per quota-carrying tier with the right percentage, skipping unquota\'d tiers', () => {
    const vdc = makeVdc({
      storagePolicies: [
        { policyId: 'p1', name: 'Gold', storageId: 'ceph-gold', quotaMb: 1024 * 100 },
        { policyId: 'p2', name: 'Bronze', storageId: 'nfs-slow', quotaMb: null },
      ],
      usage: {
        usedVcpus: 0,
        usedRamMb: 0,
        usedStorageMb: 0,
        usedVms: 0,
        usedSnapshots: 0,
        usedBackups: 0,
        usedStorageByStorage: { 'ceph-gold': 1024 * 90 },
      },
    })

    renderWithProviders(<MyVdcOverview vdc={vdc} />)

    expect(screen.getByText('Storage tiers')).toBeInTheDocument()
    expect(screen.getByText('"Gold" tier usage')).toBeInTheDocument()
    // Bronze carries no quota, so no bar and no caption for it.
    expect(screen.queryByText(/Bronze/)).not.toBeInTheDocument()

    // 90 GB used / 100 GB quota = 90%, at the error threshold.
    const bar = tierBar()

    expect(bar).toHaveAttribute('aria-valuenow', '90')
    expect(bar.className).toContain('colorError')
  })

  it('treats a tier with no recorded usage yet as 0%', () => {
    const vdc = makeVdc({
      storagePolicies: [
        { policyId: 'p1', name: 'Gold', storageId: 'ceph-gold', quotaMb: 1024 * 100 },
      ],
      // usedStorageByStorage entirely absent: the tier has never been used.
    })

    renderWithProviders(<MyVdcOverview vdc={vdc} />)

    const bar = tierBar()

    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar.className).not.toContain('colorError')
  })
})
