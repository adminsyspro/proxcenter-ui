/**
 * The vDC datacenter map used CARTO in BOTH themes, so it carried the
 * "API KEY REQUIRED" watermark everywhere and nobody had reported it
 * (issue #960). Leaflet is stubbed; only the tile source is under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('leaflet/dist/leaflet.css', () => ({}))

// Resolved and online by default, like every existing test in this file
// expects; individual tests override `licenseState` for the loading/offline
// cases.
let licenseState = { offline: false, loading: false }
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => licenseState,
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid='map'>{children}</div>,
  TileLayer: ({ url, attribution }: any) => (
    <div data-testid='tile-layer' data-url={url} data-attribution={attribution} />
  ),
  Marker: ({ children }: any) => <div data-testid='marker'>{children}</div>,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
}))

vi.mock('leaflet', () => ({
  default: { divIcon: (options: any) => options, latLngBounds: (positions: any) => positions },
}))

import MyDatacentersMapInner, { type DcEntry } from './MyDatacentersMapInner'
import { MAP_UNAVAILABLE_OFFLINE } from '@/lib/map/basemap'

const DATACENTERS = [
  {
    id: 'dc1',
    name: 'Paris',
    locationLabel: 'Paris, FR',
    country: 'FR',
    latitude: 48.8566,
    longitude: 2.3522,
    comment: null,
    nodeCount: 3,
    vmCount: 10,
    runningVmCount: 7,
    status: 'online',
    nodes: [],
  },
] as unknown as DcEntry[]

function renderMap(
  mode: 'light' | 'dark',
  basemap: { provider: string; lightUrl: string; darkUrl: string; attribution: string } = {
    provider: 'osm',
    lightUrl: '',
    darkUrl: '',
    attribution: '',
  },
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: basemap, canEdit: false }), { status: 200 }),
    ),
  )

  return renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <ThemeProvider theme={createTheme({ palette: { mode } })}>
        <MyDatacentersMapInner datacenters={DATACENTERS} />
      </ThemeProvider>
    </SWRConfig>,
  )
}

beforeEach(() => {
  licenseState = { offline: false, loading: false }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MyDatacentersMapInner tile layer', () => {
  it('serves OpenStreetMap in light mode, where CARTO used to be', async () => {
    renderMap('light')

    const layer = await screen.findByTestId('tile-layer')

    expect(layer.getAttribute('data-url')).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(layer.getAttribute('data-url')).not.toContain('cartocdn')
  })

  it('inverts those same tiles in dark mode', async () => {
    renderMap('dark')

    await waitFor(() => expect(document.head.textContent).toContain('invert(1) hue-rotate(180deg)'))
    expect(screen.getByTestId('tile-layer').getAttribute('data-url')).not.toContain('cartocdn')
  })

  it('draws nothing while the license status is still loading', async () => {
    licenseState = { offline: false, loading: true }

    renderMap('light')

    await waitFor(() => expect(screen.queryByTestId('map')).not.toBeInTheDocument())
    expect(screen.queryByTestId('tile-layer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('marker')).not.toBeInTheDocument()
  })

  it('explains the map is unavailable on an air-gapped instance with no custom tile server', async () => {
    licenseState = { offline: true, loading: false }

    renderMap('light')

    expect(await screen.findByText(MAP_UNAVAILABLE_OFFLINE)).toBeInTheDocument()
    expect(screen.queryByTestId('tile-layer')).not.toBeInTheDocument()
  })

  it('stays usable offline once a custom tile server is configured', async () => {
    licenseState = { offline: true, loading: false }

    renderMap('light', {
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: '',
      attribution: 'Internal tiles',
    })

    await waitFor(() =>
      expect(screen.getByTestId('tile-layer').getAttribute('data-url')).toBe(
        'https://tiles.lan/{z}/{x}/{y}.png',
      ),
    )
    expect(screen.queryByText(MAP_UNAVAILABLE_OFFLINE)).not.toBeInTheDocument()
  })
})
