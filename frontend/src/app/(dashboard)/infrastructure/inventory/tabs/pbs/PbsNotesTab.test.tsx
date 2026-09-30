import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import PbsNotesTab from './PbsNotesTab'

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

describe('PbsNotesTab', () => {
  it('loads the notes of the PBS on mount into the editor', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { notes: '# Lab PBS\nretention 30d' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsNotesTab pbsId="pbs-1" />)

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('# Lab PBS\nretention 30d'))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pbs/pbs-1/notes', { cache: 'no-store' })
  })

  it('shows the error of a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(502, { error: 'bad gateway' })))
    render(<PbsNotesTab pbsId="pbs-1" />)
    expect(await screen.findByText(/bad gateway/)).toBeInTheDocument()
  })
})
