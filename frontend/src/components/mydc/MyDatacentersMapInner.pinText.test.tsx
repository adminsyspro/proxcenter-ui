/**
 * A datacenter's name is free text: the pin shows it as text, character for
 * character, never as markup (roadmap#229).
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
  Popup: () => null,
  useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
}))
vi.mock('leaflet', () => ({ default: { divIcon: (options: any) => options, latLngBounds: (p: any) => p } }))

import MyDatacentersMapInner, { type DcEntry } from './MyDatacentersMapInner'

const dc = (name: string, country: string | null): DcEntry => ({
  id: 'dc1', name, locationLabel: null, country, latitude: 48.85, longitude: 2.35, comment: null,
  nodeCount: 1, vmCount: 3, runningVmCount: 2, status: 'online', nodes: [],
})

async function pin(entry: DcEntry) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {}, canEdit: false }), { status: 200 })))
  renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ThemeProvider theme={createTheme()}>
        <MyDatacentersMapInner datacenters={[entry]} />
      </ThemeProvider>
    </SWRConfig>,
  )
  await waitFor(() => expect(screen.getByTestId('marker')).toBeTruthy())
  const el = document.createElement('div')

  el.innerHTML = screen.getByTestId('marker').getAttribute('data-html') || ''

  return el
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MyDatacentersMapInner pin text', () => {
  it('shows a name holding markup as text', async () => {
    const el = await pin(dc('Default<img src="x">', null))

    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('Default<img src="x">')
  })

  it(`shows ampersands, quotes and accents unchanged, and keeps the country flag`, async () => {
    const el = await pin(dc(`R&D l'"Été"`, 'FR'))

    expect(el.textContent).toContain(`R&D l'"Été"`)
    expect(el.querySelector('img')?.getAttribute('src')).toBe('https://flagcdn.com/w20/fr.png')
    expect(el.textContent).toContain('2/3 VMs running')
  })
})
