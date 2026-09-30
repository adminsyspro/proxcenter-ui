import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'

import PbsSyslogTab from './PbsSyslogTab'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const INITIAL = [
  'Sep 30 10:00:01 pbs1 proxmox-backup-proxy[812]: starting garbage collection on store datastore1',
  'Sep 30 10:00:04 pbs1 proxmox-backup-proxy[812]: TASK OK',
]
const TAIL = [
  'Sep 30 10:00:04 pbs1 proxmox-backup-proxy[812]: TASK OK',
  'Sep 30 10:00:07 pbs1 proxmox-backup-proxy[812]: verify datastore1 vm/101 OK',
]

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

describe('PbsSyslogTab', () => {
  it('loads the last 500 journal lines of the PBS on mount', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { lines: INITIAL, source: 'journal' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsSyslogTab pbsId="pbs-1" />)

    expect(await screen.findByText(INITIAL[0])).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/pbs/pbs-1/syslog?lastentries=500')
  })

  it('polls the tail every 3 s in live mode and appends only the new lines', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse(200, { data: { lines: url.includes('lastentries=100') ? TAIL : INITIAL, source: 'journal' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<PbsSyslogTab pbsId="pbs-1" />)
    expect(await screen.findByText(INITIAL[1])).toBeInTheDocument()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('switch'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    vi.useRealTimers()

    await waitFor(() => expect(screen.getByText(TAIL[1])).toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/v1/pbs/pbs-1/syslog?lastentries=100')).toBe(true)
    // the overlapping "TASK OK" line is not duplicated
    expect(screen.getAllByText(INITIAL[1])).toHaveLength(1)
  })
})
