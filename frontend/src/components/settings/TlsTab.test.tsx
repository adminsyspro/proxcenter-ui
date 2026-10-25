import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

import TlsTab from '@/components/settings/TlsTab'
import { validityTone } from '@/components/settings/tls/CertificateStatusCard'

const payload = {
  settings: {
    enabled: false, redirectHttp: false, minVersion: 'TLSv1.2', source: 'self_signed',
    hsts: { enabled: false, maxAge: 15552000, includeSubDomains: false, preload: false },
    acme: { directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory', email: '', domains: [], renewBeforeDays: 30, eab: null },
    order: { status: 'idle', step: '', startedAt: null, finishedAt: null, message: null },
    lastError: null, failureCount: 0, nextAttemptAt: null,
  },
  eabConfigured: false,
  active: {
    id: 'c1', source: 'self_signed', commonName: 'pc.lab', sanNames: ['pc.lab'], issuer: 'CN=pc.lab',
    fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    notBefore: new Date().toISOString(), notAfter: new Date(Date.now() + 86_400_000 * 200).toISOString(),
  },
  listener: { listening: false, port: null },
  tlsPort: 8443,
  urlCoherence: { ok: true, issues: [] },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
})

// No automatic RTL cleanup is configured in this repo, hence afterEach.
afterEach(cleanup)

describe('validityTone', () => {
  const now = Date.parse('2026-09-17T00:00:00Z')

  it('is an error past the expiry', () => {
    expect(validityTone('2026-09-16T00:00:00Z', now)).toBe('error')
  })

  it('warns inside the last 30 days', () => {
    expect(validityTone('2026-10-01T00:00:00Z', now)).toBe('warning')
  })

  it('is fine beyond 30 days', () => {
    expect(validityTone('2027-01-01T00:00:00Z', now)).toBe('success')
  })
})

describe('TlsTab', () => {
  it('shows the active certificate once loaded', async () => {
    render(<TlsTab />)

    // SANs are in the closed dialog, so only the summary shows the name.
    expect(await screen.findByText('pc.lab')).toBeInTheDocument()
  })

  it('opens the certificate details from the compact row without fetching again', async () => {
    const user = userEvent.setup()

    render(<TlsTab />)

    const row = await screen.findByRole('button', { name: /^settings\.tls\.activeTitle: pc\.lab,/ })
    const callsBeforeOpen = vi.mocked(fetch).mock.calls.length

    expect(within(row).getByText('settings.tls.valid')).toBeInTheDocument()
    expect(within(row).getByText(new Date(payload.active.notAfter).toLocaleDateString())).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(payload.active.fingerprint)).not.toBeInTheDocument()
    expect(screen.queryByText(payload.active.issuer)).not.toBeInTheDocument()

    await user.click(row)

    const dialog = await screen.findByRole('dialog', { name: 'settings.tls.activeTitle' })

    expect(within(dialog).getByText(payload.active.fingerprint)).toBeVisible()
    expect(within(dialog).getByText(payload.active.issuer)).toBeVisible()
    expect(within(dialog).getByText('settings.tls.sourceSelfSigned')).toBeVisible()
    expect(within(dialog).getByText(
      `${new Date(payload.active.notBefore).toLocaleString()} – ${new Date(payload.active.notAfter).toLocaleString()}`,
    )).toBeVisible()
    expect(within(dialog).getByText('settings.tls.san').nextElementSibling).toHaveTextContent(payload.active.sanNames.join(', '))
    expect(fetch).toHaveBeenCalledTimes(callsBeforeOpen)

    await user.click(within(dialog).getByText('common.close'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(row).toHaveFocus()
  })

  it.each(['{Enter}', ' '])('opens the certificate with %s and restores focus after Escape', async key => {
    const user = userEvent.setup()

    render(<TlsTab />)

    const row = await screen.findByRole('button', { name: /^settings\.tls\.activeTitle: pc\.lab,/ })

    await user.tab()
    expect(row).toHaveFocus()
    expect(row).toHaveClass('Mui-focusVisible')

    await user.keyboard(key)
    expect(await screen.findByRole('dialog', { name: 'settings.tls.activeTitle' })).toBeVisible()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(row).toHaveFocus()
  })

  it('warns about incoherent public URLs but leaves the enable switch usable', async () => {
    // Blocking the switch here is what pushed an HTTP install into switching
    // APP_URL and NEXTAUTH_URL first, which hands out `secure` cookies before
    // any HTTPS listener exists to log in through. Warn, and let it through.
    const bad = { ...payload, urlCoherence: { ok: false, issues: ['APP_URL is still http://'] } }

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bad), { status: 200 })))
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('settings.tls.urlIncoherent')).toBeInTheDocument())
    expect(screen.getByLabelText('settings.tls.enable')).not.toBeDisabled()
  })
})

describe('HistoryCard (rendered inside TlsTab)', () => {
  const certificates = [
    {
      id: 'c1', source: 'self_signed', commonName: 'history-active.lab', fingerprint: 'AA:BB',
      notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z', isActive: true,
    },
    {
      id: 'c2', source: 'uploaded', commonName: 'history-old.lab', fingerprint: 'CC:DD',
      notBefore: '2025-01-01T00:00:00Z', notAfter: '2026-01-01T00:00:00Z', isActive: false,
    },
  ]

  function mockFetch(activateResponse?: () => Response) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/certificates')) {
        return new Response(JSON.stringify({ certificates }), { status: 200 })
      }

      if (url.includes('/certificates/') && url.endsWith('/activate') && init?.method === 'POST') {
        return activateResponse
          ? activateResponse()
          : new Response(JSON.stringify({ certificate: { ...certificates[1], isActive: true } }), { status: 200 })
      }

      return new Response(JSON.stringify(payload), { status: 200 })
    })
  }

  it('renders the history and offers no activate button on the active row', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('history-old.lab')).toBeInTheDocument())
    expect(screen.getByText('history-active.lab')).toBeInTheDocument()

    expect(screen.getAllByText('settings.tls.historyActivate')).toHaveLength(1)
    expect(screen.getByText('settings.tls.historyActive')).toBeInTheDocument()
  })

  it('activates a certificate and reloads the whole payload', async () => {
    const fetchMock = mockFetch()

    vi.stubGlobal('fetch', fetchMock)
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('history-old.lab')).toBeInTheDocument())

    fireEvent.click(screen.getByText('settings.tls.historyActivate'))

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/c2/activate'))).toBe(true))

    // The parent's own `load` (GET /api/v1/settings/tls) is called again too.
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(call => String(call[0]) === '/api/v1/settings/tls').length).toBeGreaterThan(1))
  })

  it('surfaces a 400 from the activate route instead of leaving the screen unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => new Response(JSON.stringify({ error: 'unknown certificate c2' }), { status: 400 })),
    )
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('history-old.lab')).toBeInTheDocument())

    fireEvent.click(screen.getByText('settings.tls.historyActivate'))

    await waitFor(() => expect(screen.getByText('unknown certificate c2')).toBeInTheDocument())
  })
})

describe('AcmeForm (rendered inside TlsTab)', () => {
  const acmePayload = {
    ...payload,
    settings: {
      ...payload.settings,
      source: 'acme',
      acme: { ...payload.settings.acme, domains: ['first.lab'] },
    },
  }

  /**
   * One fetch mock for the whole tab: the GET payload is read from `state` on
   * every call, so a test can change what the server answers halfway through,
   * and every write is recorded.
   */
  function mockTab(state: { payload: any }) {
    const writes: { url: string; body: any }[] = []

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/certificates')) {
        return new Response(JSON.stringify({ certificates: [] }), { status: 200 })
      }

      if (init?.method === 'PUT' || init?.method === 'POST') {
        writes.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })

        return new Response(JSON.stringify({ accepted: true }), { status: 200 })
      }

      return new Response(JSON.stringify(state.payload), { status: 200 })
    })

    return { fetchMock, writes }
  }

  function domainsField() {
    return screen.getByLabelText('settings.tls.acmeDomains') as HTMLTextAreaElement
  }

  it('switches to the free-text directory when the custom preset is picked', async () => {
    // The custom preset has no URL, which is why selecting it used to do
    // nothing at all and left an internal CA unreachable from this screen.
    const state = { payload: acmePayload }
    const { fetchMock, writes } = mockTab(state)

    vi.stubGlobal('fetch', fetchMock)
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('settings.tls.acmeDirectoryLetsencrypt')).toBeInTheDocument())
    expect(screen.queryByLabelText('settings.tls.acmeDirectory')).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('settings.tls.acmeDirectoryLetsencrypt'))
    fireEvent.click(screen.getByText('settings.tls.acmeDirectoryCustom'))

    const field = await screen.findByLabelText('settings.tls.acmeDirectory')

    // And it keeps what the operator then types, saving it once it is whole:
    // the schema wants a complete https URL, and a keystroke-by-keystroke save
    // answers 400 to every prefix of one.
    fireEvent.change(field, { target: { value: 'https://ca.int' } })
    expect(writes).toHaveLength(0)

    fireEvent.change(field, { target: { value: 'https://ca.internal/acme/directory' } })
    expect(screen.getByLabelText('settings.tls.acmeDirectory')).toHaveValue('https://ca.internal/acme/directory')

    fireEvent.blur(field)

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].body.acme.directoryUrl).toBe('https://ca.internal/acme/directory')
  })

  it('lets a second domain be typed instead of eating the newline', async () => {
    const state = { payload: acmePayload }
    const { fetchMock, writes } = mockTab(state)

    vi.stubGlobal('fetch', fetchMock)
    render(<TlsTab />)

    await waitFor(() => expect(domainsField()).toHaveValue('first.lab'))

    // Pressing Enter after the first domain. Normalising on every keystroke
    // dropped this newline the instant it appeared.
    fireEvent.change(domainsField(), { target: { value: 'first.lab\n' } })
    expect(domainsField()).toHaveValue('first.lab\n')

    fireEvent.change(domainsField(), { target: { value: 'first.lab\nsecond.lab' } })
    fireEvent.blur(domainsField())

    await waitFor(() => expect(writes.some(w => w.url === '/api/v1/settings/tls')).toBe(true))
    expect(writes.at(-1)?.body.acme.domains).toEqual(['first.lab', 'second.lab'])
  })

  it('picks up the order the server started, instead of showing idle for ever', async () => {
    const state = { payload: acmePayload }
    const { fetchMock } = mockTab(state)

    vi.stubGlobal('fetch', fetchMock)
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('settings.tls.acmeOrder')).toBeInTheDocument())

    // The order route answers 202 and the work runs in the background; the tab
    // learns about it by reloading, which is exactly what used to be thrown
    // away because the draft was kept as it was.
    state.payload = {
      ...acmePayload,
      settings: {
        ...acmePayload.settings,
        order: { status: 'pending', step: 'order', startedAt: new Date().toISOString(), finishedAt: null, message: null },
      },
    }

    fireEvent.click(screen.getByText('settings.tls.acmeOrder'))

    await waitFor(() => expect(screen.getByText('settings.tls.acmeOrdering')).toBeInTheDocument())
  })
})

describe('the history card follows the parent payload', () => {
  it('reloads the certificate list when a new certificate is generated', async () => {
    // Generating or importing one refreshes the parent, not this card: the
    // replaced certificate stayed marked Active, with no rollback button, until
    // the tab was remounted.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/certificates')) {
        return new Response(JSON.stringify({ certificates: [] }), { status: 200 })
      }

      return new Response(JSON.stringify(payload), { status: 200 })
    })

    vi.stubGlobal('fetch', fetchMock)
    render(<TlsTab />)

    await waitFor(() => expect(screen.getByText('settings.tls.generateSelfSigned')).toBeInTheDocument())

    const historyCalls = () =>
      fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/certificates')).length

    const before = historyCalls()

    fireEvent.click(screen.getByText('settings.tls.generateSelfSigned'))

    await waitFor(() => expect(historyCalls()).toBeGreaterThan(before))
  })
})
