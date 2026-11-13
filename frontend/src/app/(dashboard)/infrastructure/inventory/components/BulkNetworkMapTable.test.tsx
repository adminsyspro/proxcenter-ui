/**
 * ui#1333: the bulk dialog's network table lists the source networks of the
 * selection (one read), preloads the table saved for the pair, and saves it.
 */
import React, { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import BulkNetworkMapTable from './BulkNetworkMapTable'
import type { BulkNetworkRow } from './bulkNetworkMap'

afterEach(() => { cleanup(); server.resetHandlers() })

function seed(opts: { saved?: unknown[]; onRead?: (body: any) => void; onSave?: (body: any) => void; readStatus?: number } = {}) {
  server.use(
    http.get('/api/v1/connections/pve/network-choices', () => HttpResponse.json({ data: [{ kind: 'bridge', name: 'vmbr0', type: 'bridge' }, { kind: 'vnet', name: 'vnetdmz', zone: 'evpn' }] })),
    http.get('/api/v1/migrations/network-maps', () => HttpResponse.json({ data: { networkMap: opts.saved ?? [] } })),
    http.post('/api/v1/vmware/vc/vms/networks', async ({ request }) => {
      opts.onRead?.(await request.json())
      if (opts.readStatus) return HttpResponse.json({ error: 'SOAP login failed' }, { status: opts.readStatus })
      return HttpResponse.json({ data: { networks: [{ name: 'DMZ', vmCount: 1 }, { name: 'VM Network', vmCount: 2 }] } })
    }),
    http.put('/api/v1/migrations/network-maps', async ({ request }) => {
      const body = await request.json()
      opts.onSave?.(body)
      return HttpResponse.json({ data: { networkMap: (body as any).networkMap } })
    }),
  )
}

function Harness({ vmids = ['vm-1', 'vm-2'] }: { vmids?: string[] }) {
  const [rows, setRows] = useState<BulkNetworkRow[]>([])
  return (
    <>
      <BulkNetworkMapTable sourceConnId="vc" targetConnId="pve" targetNode="pve1" vmids={vmids} defaultBridge="vmbr0" defaultVlanTag="" canEditVlan rows={rows} onRowsChange={setRows} />
      <pre data-testid="rows">{JSON.stringify(rows)}</pre>
    </>
  )
}

describe('BulkNetworkMapTable', () => {
  it('lists the networks of the selection with the saved choices preloaded', async () => {
    let read: any
    seed({ saved: [{ source: 'DMZ', bridge: 'vnetdmz', vlanTag: 30 }], onRead: b => { read = b } })
    renderWithProviders(<Harness />)
    await screen.findByTestId('bulk-network-row-DMZ')
    expect(screen.getByTestId('bulk-network-row-VM Network')).toBeTruthy()
    expect(read).toEqual({ vmids: ['vm-1', 'vm-2'] })
    await waitFor(() => expect(JSON.parse(screen.getByTestId('rows').textContent!)).toEqual([
      { source: 'DMZ', vmCount: 1, bridge: 'vnetdmz', vlanTag: '30' },
      { source: 'VM Network', vmCount: 2, bridge: '', vlanTag: '' },
    ]))
  })

  it('saves the table for the pair', async () => {
    let saved: any
    seed({ saved: [{ source: 'DMZ', bridge: 'vnetdmz' }], onSave: b => { saved = b } })
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toContain('vnetdmz'))
    fireEvent.click(screen.getByTestId('bulk-network-map-save'))
    await waitFor(() => expect(saved).toEqual({ sourceConnectionId: 'vc', targetConnectionId: 'pve', networkMap: [{ source: 'DMZ', bridge: 'vnetdmz' }] }))
  })

  it('puts a row back on the default bridge', async () => {
    seed({ saved: [{ source: 'DMZ', bridge: 'vnetdmz', vlanTag: 30 }] })
    renderWithProviders(<Harness />)
    fireEvent.click(await screen.findByTestId('bulk-network-row-DMZ-reset'))
    await waitFor(() => expect(JSON.parse(screen.getByTestId('rows').textContent!)[0]).toEqual({ source: 'DMZ', vmCount: 1, bridge: '', vlanTag: '' }))
  })

  it('says when the networks cannot be read', async () => {
    seed({ readStatus: 500 })
    renderWithProviders(<Harness />)
    expect((await screen.findByTestId('bulk-network-map-error')).textContent).toContain('SOAP login failed')
  })
})
