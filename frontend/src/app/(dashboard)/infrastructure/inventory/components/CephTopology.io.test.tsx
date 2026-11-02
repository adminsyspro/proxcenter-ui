import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import en from '@/messages/en.json'

import CephTopology from './CephTopology'

vi.mock('@/components/ceph/CephOsdFlags', () => ({ useCephOsdFlags: () => ({ flags: [], hostFlags: {}, osdFlags: {} }) }))
vi.mock('@/components/ceph/cockpit/hooks/useCockpitLicense', () => ({ useCockpitLicense: () => ({ enterprise: false, resolved: true }) }))

const cephData = {
  crushTree: [{ id: -1, name: 'default', type: 'root', children: [{ id: -3, name: 'rack-A', type: 'rack', children: [{ id: -2, name: 'pve1', type: 'host', children: [{ id: '0', name: 'osd.0', type: 'osd', status: 'up' }, { id: '1', name: 'osd.1', type: 'osd', status: 'up' }] }] }] }],
  osds: { list: [
    { id: '0', name: 'osd.0', host: 'pve1', up: true, in: true, deviceClass: 'hdd', totalBytes: 100, usedBytes: 0, usedPct: 80 },
    { id: '1', name: 'osd.1', host: 'pve1', up: true, in: true, deviceClass: 'hdd', totalBytes: 100, usedBytes: 0, usedPct: 40 },
  ] },
  monitors: { list: [] },
  managers: { active: null, standbys: [] },
  mds: { list: [] },
  pools: { list: [] },
  crushRules: [],
  pveNodes: ['pve1'],
}

const jsonRes = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
const fetchMock = vi.fn(async (url: string) => {
  if (url.includes('/ceph/exporter?nodes=')) return jsonRes({ data: { at: 1000, nodes: { pve1: { ok: false, reason: 'refused' } }, osds: {} } })

  return jsonRes({ data: cephData })
})
const exporterUrls = () => fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/ceph/exporter'))

const unfold = (name: string) => fireEvent.click(screen.getByText(name).closest('div')!.querySelector('i.ri-arrow-right-s-line')!)

function renderTree() {
  return render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={createTheme()}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <CephTopology connId='c1' />
        </SWRConfig>
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CephTopology IOPS and throughput of the OSD leaves', () => {
  it('reads the exporter only once the OSD rows are on screen, for the nodes of those rows', async () => {
    renderTree()
    await screen.findByText('pve1')
    // Root and rack are open by default, the host is folded: no OSD row, no header, no exporter call.
    expect(screen.queryByTestId('crush-osd-io')).toBeNull()
    expect(exporterUrls()).toEqual([])

    unfold('pve1')
    await waitFor(() => expect(screen.getAllByTestId('crush-osd-io')).toHaveLength(2))
    await waitFor(() => expect(exporterUrls()).toEqual(['/api/v1/connections/c1/ceph/exporter?nodes=pve1']))
    expect(screen.getByText(en.cephCockpit.osd.columns.iops)).toBeInTheDocument()
    expect(screen.getByText(en.cephCockpit.osd.columns.throughput)).toBeInTheDocument()
  })

  it('a node without exporter gives dashes with the help tooltip in both columns of each OSD', async () => {
    renderTree()
    await screen.findByText('pve1')
    unfold('pve1')
    await waitFor(() => expect(screen.getAllByTestId('osd-io-absent')).toHaveLength(4))
  })

  it('the help tooltip says why the exporter of the node is not read, naming the node', async () => {
    renderTree()
    await screen.findByText('pve1')
    unfold('pve1')
    await waitFor(() => expect(screen.getAllByTestId('osd-io-absent')).toHaveLength(4))
    expect(screen.getAllByTestId('osd-io-absent')[0].getAttribute('aria-label')).toMatch(/^Nothing listens on port \d+ of pve1: /)
  })
})
