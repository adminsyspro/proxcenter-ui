import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import PbsTrafficControlTab from './PbsTrafficControlTab'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PbsTrafficControlTab', () => {
  it('loads the traffic-control rules of the PBS on mount and lists them', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ name: 'office-hours', network: '10.42.0.0/24', 'rate-in': 10485760, timeframe: 'mon..fri 8:00-18:00', comment: 'throttle' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsTrafficControlTab pbsId="pbs-1" />)

    expect(await screen.findByText('office-hours')).toBeInTheDocument()
    expect(screen.getByText('10.42.0.0/24')).toBeInTheDocument()
    expect(screen.getByText('throttle')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pbs/pbs-1/traffic-control', { cache: 'no-store' })
  })

  it('shows the error of a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'tc failed' })))
    render(<PbsTrafficControlTab pbsId="pbs-1" />)
    expect(await screen.findByText(/tc failed/)).toBeInTheDocument()
  })
})
