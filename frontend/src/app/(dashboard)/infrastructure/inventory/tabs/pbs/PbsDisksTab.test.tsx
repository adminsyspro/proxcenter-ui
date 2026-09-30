import { describe, it, expect } from 'vitest'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import PbsDisksTab from './PbsDisksTab'

const PBS_ID = 'pbs-1'

describe('PbsDisksTab', () => {
  it('fetches every section for the PBS on mount and renders the returned rows', async () => {
    const hits: string[] = []
    const routes: Record<string, unknown[]> = { disks: [{ name: 'sda', model: 'SAMSUNG_MZ7LH960', serial: 'S45NNE0M' }], 'disks/directory': [], 'disks/zfs': [] }
    for (const [path, data] of Object.entries(routes)) {
      server.use(
        http.get(`*/api/v1/pbs/${PBS_ID}/${path}`, ({ request }) => {
          hits.push(new URL(request.url).pathname)
          return HttpResponse.json({ data })
        }),
      )
    }

    renderWithProviders(<PbsDisksTab pbsId={PBS_ID} />)

    expect(await screen.findByText('SAMSUNG_MZ7LH960')).toBeInTheDocument()
    expect(hits.sort()).toEqual(Object.keys(routes).map(p => `/api/v1/pbs/${PBS_ID}/${p}`).sort())
  })

  it('shows the backend error when a section request fails', async () => {
    server.use(http.get(`*/api/v1/pbs/${PBS_ID}/*`, () => HttpResponse.json({ error: 'pbs unreachable' }, { status: 502 })))

    renderWithProviders(<PbsDisksTab pbsId={PBS_ID} />)

    expect(await screen.findByText(/pbs unreachable/)).toBeInTheDocument()
  })
})
