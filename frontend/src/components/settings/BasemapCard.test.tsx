/**
 * The basemap picker of the Appearance tab (issue #960). What matters here is
 * what reaches the maps: a default that needs no API key, a custom template
 * that cannot be saved unless it can actually draw tiles, and a form that goes
 * read-only rather than letting a non-admin type into a 403.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import BasemapCard from './BasemapCard'

const OSM_SETTINGS = { provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' }

let putBody: any = null
let putResponse: { status: number; body: unknown } = { status: 200, body: { data: OSM_SETTINGS } }

function mockFetch(stored: unknown, canEdit = true) {
  putBody = null

  let current = stored

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body))

        if (putResponse.status === 200) current = putBody

        return new Response(JSON.stringify(putResponse.body), { status: putResponse.status })
      }

      return new Response(JSON.stringify({ data: current, canEdit }), { status: 200 })
    }),
  )
}

// renderWithProviders pins revalidateOnMount to false for the suites that do
// not want a fetch on mount; this card is all about what it loads, so the
// nested config turns it back on for these tests only.
function renderCard() {
  return renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <BasemapCard />
    </SWRConfig>,
  )
}

async function switchToCustom() {
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByRole('option', { name: 'Custom tile server' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  putResponse = { status: 200, body: { data: OSM_SETTINGS } }
})

describe('BasemapCard', () => {
  it('lands on the keyless OpenStreetMap default and hides the custom fields', async () => {
    mockFetch(OSM_SETTINGS)
    renderCard()

    expect(await screen.findByText('Map basemap')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('OpenStreetMap'))
    expect(screen.queryByLabelText(/Tile URL, light theme/)).toBeNull()
  })

  it('stays on the default when the route answers the demo-mode empty array', async () => {
    mockFetch([])
    renderCard()

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('OpenStreetMap'))
  })

  it('shows a stored custom source with its fields filled', async () => {
    mockFetch({
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: '',
      attribution: 'Internal tiles',
    })
    renderCard()

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Custom tile server'))
    expect((screen.getByLabelText(/Tile URL, light theme/) as HTMLInputElement).value).toBe(
      'https://tiles.lan/{z}/{x}/{y}.png',
    )
    expect((screen.getByLabelText(/^Attribution/) as HTMLInputElement).value).toBe('Internal tiles')
  })

  it('refuses to save a template that cannot draw tiles', async () => {
    mockFetch(OSM_SETTINGS)
    renderCard()

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('OpenStreetMap'))
    await switchToCustom()

    // Empty: nothing to save yet.
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/Tile URL, light theme/), {
      target: { value: 'https://tiles.lan/preview.png' },
    })

    expect(screen.getAllByText(/not a tile template/).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves a complete custom source and confirms it', async () => {
    mockFetch(OSM_SETTINGS)
    renderCard()

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('OpenStreetMap'))
    await switchToCustom()

    fireEvent.change(screen.getByLabelText(/Tile URL, light theme/), {
      target: { value: 'https://tiles.lan/{z}/{x}/{y}.png' },
    })
    fireEvent.change(screen.getByLabelText(/Tile URL, dark theme/), {
      target: { value: 'https://tiles.lan/dark/{z}/{x}/{y}.png' },
    })
    fireEvent.change(screen.getByLabelText(/^Attribution/), { target: { value: 'Internal tiles' } })

    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(screen.getByText('Basemap saved.')).toBeTruthy())
    expect(putBody).toEqual({
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: 'https://tiles.lan/dark/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
    })
  })

  it('surfaces the error the route answers instead of claiming success', async () => {
    mockFetch(OSM_SETTINGS)
    putResponse = { status: 400, body: { error: 'The light tile URL must contain {z}, {x} and {y}' } }
    renderCard()

    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('OpenStreetMap'))
    await switchToCustom()

    fireEvent.change(screen.getByLabelText(/Tile URL, light theme/), {
      target: { value: 'https://tiles.lan/{z}/{x}/{y}.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(screen.getByText(/must contain/)).toBeTruthy())
  })

  it('goes read-only for a user who cannot change the setting', async () => {
    mockFetch(OSM_SETTINGS, false)
    renderCard()

    expect(await screen.findByText('Only an administrator can change the basemap.')).toBeTruthy()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true),
    )
  })
})
