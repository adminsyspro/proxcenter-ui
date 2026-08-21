/**
 * Component tests for the OPTIONAL per-tier axis of VdcQuotaBanner.
 *
 * The four global axes (vCPU/RAM/storage/VMs) predate this lot and are only
 * asserted here as the baseline the tier must not disturb: callers that pass
 * no `tier` keep exactly four donuts and their previous blocked verdict.
 *
 * The tier axis mirrors the server-side per-storage-policy quota check
 * (checkVdcQuota, quota.ts): projected = used + requested against the
 * policy's quotaMb. It feeds the same `blocked` signal as the other axes, so
 * the deploy wizard can gate its Next/Deploy button on the Hardware step
 * instead of letting the user reach the last step and eat a 409.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import VdcQuotaBanner from './VdcQuotaBanner'

const quota = { maxVcpus: 8, maxRamMb: 16384, maxStorageMb: null, maxVms: 10 }
const usage = { usedVcpus: 2, usedRamMb: 4096, usedStorageMb: 40960, usedVms: 2 }
const requested = { vcpus: 2, ramMb: 2048, storageMb: 20480, vms: 1 }

afterEach(cleanup)

describe('VdcQuotaBanner, per-tier storage axis', () => {
  it('stays at four axes and unblocked when no tier is passed', () => {
    const onStateChange = vi.fn()

    renderWithProviders(
      <VdcQuotaBanner quota={quota} usage={usage} requested={requested} onStateChange={onStateChange} />,
    )

    expect(screen.getByText('vCPUs')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('vDC quota')).toBeInTheDocument()
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ blocked: false }))
  })

  it('adds the tier donut, labelled with the policy name, when the tier fits', () => {
    const onStateChange = vi.fn()

    renderWithProviders(
      <VdcQuotaBanner
        quota={quota}
        usage={usage}
        requested={requested}
        tier={{ name: 'gold-tier', used: 40960, requested: 20480, max: 102400 }}
        onStateChange={onStateChange}
      />,
    )

    // 40 GB used + 20 GB requested = 60 GB, under the 100 GB tier quota.
    expect(screen.getByText('gold-tier')).toBeInTheDocument()
    expect(screen.getByText('vDC quota')).toBeInTheDocument()
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ blocked: false }))
  })

  it('blocks on the tier alone, with every global axis within limits', () => {
    const onStateChange = vi.fn()

    renderWithProviders(
      <VdcQuotaBanner
        quota={quota}
        usage={usage}
        requested={requested}
        tier={{ name: 'test-qos', used: 40960, requested: 20480, max: 10240 }}
        onStateChange={onStateChange}
      />,
    )

    // 40 GB used + 20 GB requested = 60 GB against a 10 GB tier quota: the
    // global axes all fit, so only the tier can be blocking here.
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ blocked: true, overCount: 1 }))
    expect(screen.getByText('vDC quota exceeded')).toBeInTheDocument()
    // The violation row states the overshoot: 60 GB projected - 10 GB quota.
    expect(screen.getByText('+50.0 GB')).toBeInTheDocument()
  })
})
