import { describe, it, expect } from 'vitest'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import PbsS3EndpointsTab from './PbsS3EndpointsTab'

const PBS_ID = 'pbs-1'

describe('PbsS3EndpointsTab', () => {
  it('fetches every section for the PBS on mount and renders the returned rows', async () => {
    const hits: string[] = []
    const routes: Record<string, unknown[]> = { 's3-endpoints': [{ id: 'minio', endpoint: 's3.lab.local:9000' }] }
    for (const [path, data] of Object.entries(routes)) {
      server.use(
        http.get(`*/api/v1/pbs/${PBS_ID}/${path}`, ({ request }) => {
          hits.push(new URL(request.url).pathname)
          return HttpResponse.json({ data })
        }),
      )
    }

    renderWithProviders(<PbsS3EndpointsTab pbsId={PBS_ID} />)

    expect(await screen.findByText('s3.lab.local:9000')).toBeInTheDocument()
    expect(hits.sort()).toEqual(Object.keys(routes).map(p => `/api/v1/pbs/${PBS_ID}/${p}`).sort())
  })

  it('shows the backend error when a section request fails', async () => {
    server.use(http.get(`*/api/v1/pbs/${PBS_ID}/*`, () => HttpResponse.json({ error: 'pbs unreachable' }, { status: 502 })))

    renderWithProviders(<PbsS3EndpointsTab pbsId={PBS_ID} />)

    expect(await screen.findByText(/pbs unreachable/)).toBeInTheDocument()
  })
})
