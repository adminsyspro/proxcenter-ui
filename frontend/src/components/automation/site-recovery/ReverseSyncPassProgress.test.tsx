import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { ReverseSyncProgress } from '@/lib/orchestrator/site-recovery.types'
import { formatBytes } from '@/utils/format'

import ReverseSyncPassProgress, { formatElapsed, passPercent } from './ReverseSyncPassProgress'

const started = '2026-11-26T17:00:00Z'
const at = (seconds: number) => new Date(started).getTime() + seconds * 1000

function progress(overrides: Partial<ReverseSyncProgress> = {}): ReverseSyncProgress {
  return { stage: 'transferring', disk: 1, disks: 2, bytes: 512 * 1024 * 1024, total_bytes: 1024 * 1024 * 1024, throughput_bps: 4 * 1024 * 1024, started_at: started, ...overrides }
}

describe('formatElapsed', () => {
  it('reads seconds, minutes and hours', () => {
    expect(formatElapsed(12.9)).toBe('12 s')
    expect(formatElapsed(245)).toBe('4 min 05 s')
    expect(formatElapsed(3725)).toBe('1 h 02 min')
    expect(formatElapsed(-3)).toBe('0 s')
  })
})

describe('passPercent', () => {
  it('is the share of the estimate, held at 99 until the pass lands', () => {
    expect(passPercent(progress())).toBe(50)
    expect(passPercent(progress({ bytes: 2 * 1024 * 1024 * 1024 }))).toBe(99)
  })

  it('has no value while aligning or without an estimate', () => {
    expect(passPercent(progress({ stage: 'aligning' }))).toBeNull()
    expect(passPercent(progress({ total_bytes: undefined }))).toBeNull()
    expect(passPercent(progress({ total_bytes: 0 }))).toBeNull()
  })
})

describe('ReverseSyncPassProgress', () => {
  afterEach(cleanup)

  it('shows the disk being sent, how much of it, at what rate and for how long', () => {
    renderWithProviders(<ReverseSyncPassProgress progress={progress()} now={at(125)} />)

    expect(screen.getByText('Sending disk 1 of 2')).toBeInTheDocument()
    expect(screen.getByText(`50% · ${formatBytes(512 * 1024 * 1024)} of ${formatBytes(1024 * 1024 * 1024)} · ${formatBytes(4 * 1024 * 1024)}/s · running for 2 min 05 s`)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })

  it('counts without a percentage when the size of the stream is unknown', () => {
    renderWithProviders(<ReverseSyncPassProgress progress={progress({ total_bytes: undefined, throughput_bps: undefined })} now={at(5)} />)

    expect(screen.getByText(`${formatBytes(512 * 1024 * 1024)} · running for 5 s`)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  })

  it('names the alignment of the source, which streams nothing yet', () => {
    renderWithProviders(<ReverseSyncPassProgress progress={progress({ stage: 'aligning', disk: undefined, disks: undefined, bytes: 0, total_bytes: undefined })} now={at(30)} />)

    expect(screen.getByText('Aligning the source VM on the last snapshot both sites share')).toBeInTheDocument()
    expect(screen.getByText('running for 30 s')).toBeInTheDocument()
  })
})
