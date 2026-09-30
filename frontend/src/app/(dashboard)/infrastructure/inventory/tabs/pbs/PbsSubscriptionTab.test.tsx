import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import PbsSubscriptionTab from './PbsSubscriptionTab'

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

describe('PbsSubscriptionTab', () => {
  it('loads the subscription of the PBS on mount and shows its details', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: { status: 'active', productname: 'Proxmox Backup Server Basic', serverid: 'ABCDEF0123456789', level: 'b', key: 'pbsb-1234567890' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsSubscriptionTab pbsId="pbs-1" />)

    expect(await screen.findByText('Proxmox Backup Server Basic')).toBeInTheDocument()
    expect(screen.getByText('ABCDEF0123456789')).toBeInTheDocument()
    expect(screen.getByText('pbsb-123••••••••')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pbs/pbs-1/subscription', { cache: 'no-store' })
  })

  it('shows the error of a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'subscription failed' })))
    render(<PbsSubscriptionTab pbsId="pbs-1" />)
    expect(await screen.findByText(/subscription failed/)).toBeInTheDocument()
  })
})
