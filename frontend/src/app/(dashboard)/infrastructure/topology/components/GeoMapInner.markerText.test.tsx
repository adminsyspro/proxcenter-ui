/**
 * A connection's name and location label are free text: the marker shows them
 * as text, character for character, never as markup (roadmap#229).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ offline: false, loading: false }) }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid='map'>{children}</div>,
  TileLayer: () => null,
  Marker: ({ icon }: any) => <div data-testid='marker' data-html={icon.html} />,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
}))
vi.mock('leaflet', () => ({ default: { divIcon: (options: any) => options, latLngBounds: (p: any) => p } }))

import GeoMapInner from './GeoMapInner'
import type { InventoryCluster } from '../types'

const conn = (id: string, name: string, locationLabel: string | null) => ({
  id, name, locationLabel, type: 'pve', isCluster: true, status: 'online', latitude: 45 + Number(id.slice(1)), longitude: 4, nodes: [],
}) as unknown as InventoryCluster

async function markers(connections: InventoryCluster[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {}, canEdit: false }), { status: 200 })))
  renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ThemeProvider theme={createTheme()}>
        <GeoMapInner connections={connections} onSelectCluster={vi.fn()} />
      </ThemeProvider>
    </SWRConfig>,
  )
  await waitFor(() => expect(screen.getAllByTestId('marker')).toHaveLength(connections.length))

  return screen.getAllByTestId('marker').map(m => {
    const el = document.createElement('div')

    el.innerHTML = m.getAttribute('data-html') || ''

    return el
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GeoMapInner marker text', () => {
  it('shows a name and a location label holding markup as text', async () => {
    const [m] = await markers([conn('c1', 'DR<img src="x">', 'Paris<b>DR</b>')])

    expect(m.querySelector('img, b')).toBeNull()
    expect(m.textContent).toContain('DR<img src="x">')
    expect(m.textContent).toContain('Paris<b>DR</b>')
  })

  it('shows ampersands, quotes and accents unchanged, cut at the same length', async () => {
    const [short, long] = await markers([
      conn('c1', `R&D l'"Été"`, 'Lyon & Saint-Étienne'),
      conn('c2', 'A very long cluster name & more', `Location label that's far too long`),
    ])

    expect(short.textContent).toContain(`R&D l'"Été"`)
    expect(short.textContent).toContain('Lyon & Saint-Étienne')
    expect(long.textContent).toContain('A very long clust…')
    expect(long.textContent).toContain(`Location label that's…`)
    expect(short.querySelector('[data-conn-id]')?.getAttribute('data-conn-id')).toBe('c1')
  })
})
