import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import PbsCertificatesTab from './PbsCertificatesTab'

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

describe('PbsCertificatesTab', () => {
  it('loads the certificates of the PBS on mount and lists them', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, {
      data: [{ filename: 'proxy.pem', subject: 'CN=pbs1.lab', issuer: 'CN=Lab CA', notafter: 4102444800 }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsCertificatesTab pbsId="pbs-1" />)

    expect(await screen.findByText('proxy.pem')).toBeInTheDocument()
    expect(screen.getByText('CN=pbs1.lab')).toBeInTheDocument()
    expect(screen.getByText('CN=Lab CA')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pbs/pbs-1/certificates', { cache: 'no-store' })
  })

  it('shows the error of a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'PBS unreachable' })))
    render(<PbsCertificatesTab pbsId="pbs-1" />)
    expect(await screen.findByText(/PBS unreachable/)).toBeInTheDocument()
  })
})
