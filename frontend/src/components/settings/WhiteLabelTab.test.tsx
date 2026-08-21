import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, userEvent } from '@/__tests__/setup/renderWithProviders'

const h = vi.hoisted(() => ({ refresh: vi.fn(async () => {}) }))

vi.mock('@/contexts/BrandingContext', () => ({
  useBranding: () => ({ branding: { primaryColor: '' }, loading: false, refresh: h.refresh }),
}))

import WhiteLabelTab from './WhiteLabelTab'

const STORED = { enabled: true, appName: 'ProxCenter', primaryColor: '', logoUrl: '', faviconUrl: '', loginLogoUrl: '' }

let putBodies: any[] = []

beforeEach(() => {
  putBodies = []
  h.refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBodies.push(JSON.parse(String(init.body)))

        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      return new Response(JSON.stringify(STORED), { status: 200 })
    })
  )
})

// The RTL harness in this suite has no automatic cleanup.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderTab = async () => {
  renderWithProviders(<WhiteLabelTab />)
  await waitFor(() => expect(screen.getByLabelText('Hex Color')).toBeTruthy())

  return {
    field: screen.getByLabelText('Hex Color') as HTMLInputElement,
    save: screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement,
  }
}

const typeColor = async (field: HTMLInputElement, value: string) => {
  await userEvent.clear(field)
  if (value) await userEvent.type(field, value)
}

// #754: a colour the palette cannot parse used to be saved without a word of
// warning and then 500 every page of the tenant, login page included.
describe('WhiteLabelTab primary colour validation (#754)', () => {
  it('adds the missing hash to what gets sent', async () => {
    const { field, save } = await renderTab()

    await typeColor(field, '00ECB2')
    expect(save.disabled).toBe(false)

    await userEvent.click(save)

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0].primaryColor).toBe('#00ECB2')
  })

  it('blocks saving and explains itself when the value is not a colour', async () => {
    const { field, save } = await renderTab()

    await typeColor(field, 'turquoi')

    expect(screen.getByText(/Enter a hex colour/i)).toBeTruthy()
    await waitFor(() => expect(save.disabled).toBe(true))
    expect(putBodies).toHaveLength(0)
  })

  it('accepts an empty field as "no override"', async () => {
    const { field, save } = await renderTab()

    await typeColor(field, '')

    expect(screen.queryByText(/Enter a hex colour/i)).toBeNull()
    expect(save.disabled).toBe(false)

    await userEvent.click(save)

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0].primaryColor).toBe('')
  })

  it('keeps a well-formed colour as typed', async () => {
    const { field, save } = await renderTab()

    await typeColor(field, '#00ECB2')
    await userEvent.click(save)

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0].primaryColor).toBe('#00ECB2')
  })
})
