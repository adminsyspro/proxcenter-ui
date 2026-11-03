/**
 * The progress bar a running disk or volume move shows on its task row
 * (roadmap#196). next-intl is mocked to echo the key and its values, so the
 * assertions name the catalogue entry and what was put in it.
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import MoveTaskProgress, { moveProgressDetails } from './MoveTaskProgress'

const echo = (key: string, values?: Record<string, string>) => (values ? `${key}(${JSON.stringify(values)})` : key)

vi.mock('next-intl', () => ({
  useTranslations: () => echo,
}))

afterEach(() => cleanup())

const MIB = 1024 ** 2
const FULL = { percent: 49.6, doneBytes: 512 * MIB, totalBytes: 1024 * MIB, bytesPerSec: 256 * MIB, etaSec: 2 }

describe('moveProgressDetails', () => {
  it('names the bytes, the throughput and the time left', () => {
    expect(moveProgressDetails(FULL, echo)).toBe(
      'tasks.moveProgress.bytes({"done":"512 MiB","total":"1 GiB"}), 256 MiB/s, tasks.moveProgress.eta({"eta":"2s"})',
    )
  })

  it('says only what is known', () => {
    expect(moveProgressDetails({ percent: 45, doneBytes: null, totalBytes: null, bytesPerSec: null, etaSec: null }, echo)).toBe('')
    expect(moveProgressDetails({ ...FULL, bytesPerSec: null, etaSec: 0 }, echo)).toBe('tasks.moveProgress.bytes({"done":"512 MiB","total":"1 GiB"})')
  })
})

describe('MoveTaskProgress', () => {
  it('draws a determinate bar at the rounded percentage', () => {
    render(<MoveTaskProgress progress={FULL} />)

    const bar = screen.getByRole('progressbar', { name: 'tasks.moveProgress.label' })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('falls back to its label as tooltip when nothing else is known', () => {
    render(<MoveTaskProgress progress={{ percent: 45, doneBytes: null, totalBytes: null, bytesPerSec: null, etaSec: null }} />)

    expect(screen.getByLabelText('tasks.moveProgress.label', { selector: 'div[aria-label]:not([role])' })).toBeTruthy()
  })
})
