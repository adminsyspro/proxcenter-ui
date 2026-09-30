import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import PbsRemotesTab from './PbsRemotesTab'

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

describe('PbsRemotesTab', () => {
  it('loads the remotes of the PBS on mount and lists them', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ name: 'offsite', host: '10.42.0.202', port: 8007, 'auth-id': 'sync@pbs', comment: 'DR copy' }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsRemotesTab pbsId="pbs-1" />)

    expect(await screen.findByText('offsite')).toBeInTheDocument()
    expect(screen.getByText('10.42.0.202')).toBeInTheDocument()
    expect(screen.getByText('8007')).toBeInTheDocument()
    expect(screen.getByText('DR copy')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pbs/pbs-1/remotes', { cache: 'no-store' })
  })

  it('shows the error of a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'remotes failed' })))
    render(<PbsRemotesTab pbsId="pbs-1" />)
    expect(await screen.findByText(/remotes failed/)).toBeInTheDocument()
  })
})
