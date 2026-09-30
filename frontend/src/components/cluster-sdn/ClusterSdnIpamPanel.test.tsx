import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import ClusterSdnIpamPanel from './ClusterSdnIpamPanel'

const CONN_ID = 'conn-1'

describe('ClusterSdnIpamPanel', () => {
  afterEach(cleanup)

  it('loads the IPAM backends on mount, selects the first and loads its allocations', async () => {
    const statusCalls: string[] = []
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/sdn/ipams`, () =>
        HttpResponse.json({ data: { ipams: [{ ipam: 'pve', type: 'pve' }, { ipam: 'nb', type: 'netbox' }] } }),
      ),
      http.get(`*/api/v1/connections/${CONN_ID}/sdn/ipams/:ipam/status`, ({ params }) => {
        statusCalls.push(String(params.ipam))
        return HttpResponse.json({ data: { allocations: [{ hostname: 'web-01', ip: '10.0.0.5', mac: 'aa:bb:cc:dd:ee:ff' }] } })
      }),
    )

    renderWithProviders(<ClusterSdnIpamPanel connId={CONN_ID} />)

    expect(await screen.findByText('pve (pve)')).toBeInTheDocument()
    await waitFor(() => expect(statusCalls).toEqual(['pve']))
    expect(await screen.findByText('10.0.0.5')).toBeInTheDocument()
  })

  it('shows the no-backends notice when the list is empty', async () => {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/sdn/ipams`, () => HttpResponse.json({ data: { ipams: [] } })),
    )
    renderWithProviders(<ClusterSdnIpamPanel connId={CONN_ID} />)
    await waitFor(() => expect(document.querySelector('.MuiCircularProgress-root')).toBeNull())
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
