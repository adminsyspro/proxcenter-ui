import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

import DnsChallengeForm from '@/components/settings/tls/DnsChallengeForm'

const powerdns = { provider: 'powerdns' as const, credentials: { apiKey: '' }, validationDelaySeconds: 30 }

function renderForm(props: Partial<Parameters<typeof DnsChallengeForm>[0]> = {}) {
  const onChange = vi.fn()

  render(<DnsChallengeForm dns={powerdns} secretsConfigured={[]} hasDomains onChange={onChange} {...props} />)

  return onChange
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, failures: [] }), { status: 200 })))
})

// No automatic RTL cleanup is configured in this repo, hence afterEach.
afterEach(cleanup)

describe('DnsChallengeForm', () => {
  it('commits a secret on blur only, never per keystroke', () => {
    const onChange = renderForm()
    const field = screen.getByLabelText('settings.tls.dns.fields.apiKey')

    fireEvent.change(field, { target: { value: 'tok' } })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.blur(field, { target: { value: 'tok' } })
    expect(onChange).toHaveBeenCalledWith({ ...powerdns, credentials: { apiKey: 'tok' } })
  })

  it('leaves a stored secret alone when its field is left blank, and says it is stored', () => {
    const onChange = renderForm({ secretsConfigured: ['apiKey'] })
    const field = screen.getByLabelText('settings.tls.dns.fields.apiKey')

    expect(screen.getByText('settings.tls.dns.secretStored')).toBeTruthy()
    fireEvent.blur(field, { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stores the default of a select field as soon as the provider is picked', () => {
    const onChange = renderForm({ dns: { provider: null, credentials: {}, validationDelaySeconds: 30 } })

    fireEvent.mouseDown(screen.getByLabelText('settings.tls.dns.provider'))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('RFC 2136 (nsupdate, BIND)'))

    expect(onChange).toHaveBeenCalledWith({ provider: 'rfc2136', credentials: { keyAlgorithm: 'hmac-sha256' }, validationDelaySeconds: 30 })
  })

  it('puts a hint on the fields whose name can be misread, and only on those', () => {
    renderForm({ dns: { provider: 'acmedns', credentials: {}, validationDelaySeconds: 30 } })

    expect(screen.getByLabelText('settings.tls.dns.hints.subdomain')).toBeTruthy()
    expect(screen.queryByLabelText('settings.tls.dns.hints.username')).toBeNull()
  })

  it('clamps the validation delay into its range', () => {
    const onChange = renderForm()
    const field = screen.getByLabelText('settings.tls.dns.validationDelay')

    fireEvent.change(field, { target: { value: '5000' } })
    fireEvent.blur(field)

    expect(onChange).toHaveBeenCalledWith({ ...powerdns, validationDelaySeconds: 600 })
  })

  it('lists the failing domains a test reports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, failures: [{ domain: 'pc.other.org', reason: 'no zone' }] }), { status: 200 },
    )))
    renderForm()

    fireEvent.click(screen.getByText('settings.tls.dns.test'))

    await waitFor(() => expect(screen.getByText('pc.other.org: no zone')).toBeTruthy())
  })

  it('shows success when every zone is reachable, and keeps the test off without domains', async () => {
    renderForm()
    fireEvent.click(screen.getByText('settings.tls.dns.test'))
    await waitFor(() => expect(screen.getByText('settings.tls.dns.testOk')).toBeTruthy())

    cleanup()
    renderForm({ hasDomains: false })
    expect((screen.getByText('settings.tls.dns.test').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
