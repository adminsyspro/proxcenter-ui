/**
 * What the geographic topology map asks its tile server for (issue #960).
 * Leaflet itself is stubbed: the point is the URL, the attribution and the
 * dark-mode inversion, not the rendering engine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

// The component pulls leaflet.css, which sends vitest through PostCSS and its
// Tailwind plugin for nothing; the stylesheet has no bearing on these
// assertions.
vi.mock('leaflet/dist/leaflet.css', () => ({}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid='map'>{children}</div>,
  TileLayer: ({ url, attribution }: any) => (
    <div data-testid='tile-layer' data-url={url} data-attribution={attribution} />
  ),
  // The real marker dispatches a Leaflet event; the click handler under test
  // only reads `originalEvent.target`, which the test sets per case.
  Marker: ({ position, eventHandlers }: any) => (
    <button
      data-testid='marker'
      data-position={String(position)}
      onClick={() => eventHandlers?.click?.({ originalEvent: { target: (globalThis as any).__markerTarget } })}
    />
  ),
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
}))

vi.mock('leaflet', () => ({
  default: {
    divIcon: (options: any) => options,
    latLngBounds: (positions: any) => positions,
  },
}))

import GeoMapInner from './GeoMapInner'
import type { InventoryCluster } from '../types'

const CONNECTIONS = [
  {
    id: 'c1',
    name: 'PVE-PROD',
    type: 'pve',
    isCluster: true,
    status: 'online',
    latitude: 48.8566,
    longitude: 2.3522,
    nodes: [],
  },
] as unknown as InventoryCluster[]

function mockFetch(stored: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: stored, canEdit: false }), { status: 200 })),
  )
}

function renderMap(mode: 'light' | 'dark', onSelectCluster: (c: unknown) => void = vi.fn()) {
  return renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <ThemeProvider theme={createTheme({ palette: { mode } })}>
        <GeoMapInner connections={CONNECTIONS} onSelectCluster={onSelectCluster as any} />
      </ThemeProvider>
    </SWRConfig>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (globalThis as any).__markerTarget
})

describe('GeoMapInner tile layer', () => {
  it('asks OpenStreetMap for its tiles, never a keyless CARTO basemap', async () => {
    mockFetch({ provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' })
    renderMap('light')

    const layer = await screen.findByTestId('tile-layer')

    expect(layer.getAttribute('data-url')).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(layer.getAttribute('data-url')).not.toContain('cartocdn')
    expect(layer.getAttribute('data-attribution')).toContain('OpenStreetMap')
    expect(document.head.textContent).toContain('filter:none')
  })

  it('inverts the same tiles for dark mode instead of switching provider', async () => {
    mockFetch({ provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' })
    renderMap('dark')

    const layer = await screen.findByTestId('tile-layer')

    expect(layer.getAttribute('data-url')).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    await waitFor(() => expect(document.head.textContent).toContain('invert(1) hue-rotate(180deg)'))
  })

  it('follows a configured tile server, dark template included', async () => {
    mockFetch({
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: 'https://tiles.lan/dark/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
    })
    renderMap('dark')

    await waitFor(() =>
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toBe(
        'https://tiles.lan/dark/{z}/{x}/{y}.png',
      ),
    )
    expect(screen.getByTestId('tile-layer').getAttribute('data-attribution')).toBe('Internal tiles')
  })

  it('still draws a marker per location', async () => {
    mockFetch({ provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' })
    renderMap('light')

    expect(await screen.findByTestId('marker')).toBeTruthy()
  })

  it('opens the connection whose row was clicked inside a grouped pin', async () => {
    mockFetch({ provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' })

    const onSelect = vi.fn()

    ;(globalThis as any).__markerTarget = { closest: () => ({ getAttribute: () => 'c1' }) }
    renderMap('light', onSelect)
    fireEvent.click(await screen.findByTestId('marker'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
  })

  it('falls back to the first connection of the pin when no row was hit', async () => {
    mockFetch({ provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' })

    const onSelect = vi.fn()

    ;(globalThis as any).__markerTarget = { closest: () => null }
    renderMap('light', onSelect)
    fireEvent.click(await screen.findByTestId('marker'))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
  })
})
