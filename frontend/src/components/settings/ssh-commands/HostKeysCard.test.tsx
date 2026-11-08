import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import HostKeysCardRaw from './HostKeysCard'

// renderWithProviders turns revalidateOnMount off; the card loads on mount.
function HostKeysCard() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <HostKeysCardRaw />
    </SWRConfig>
  )
}

afterEach(cleanup)

const KEYS = [
  { host: '10.0.0.1:22', keyType: 'ssh-ed25519', fingerprint: 'SHA256:conf', pendingFingerprint: null, origin: 'confirmed', confirmedBy: 'ops@example.com', confirmedAt: '2026-11-08T10:00:00Z' },
  { host: '10.0.0.2:22', keyType: 'ssh-ed25519', fingerprint: 'SHA256:auto', pendingFingerprint: null, origin: 'automatic' },
  { host: '10.0.0.3:22', keyType: 'ecdsa-sha2-nistp256', fingerprint: null, pendingFingerprint: 'SHA256:pend', origin: 'pending' },
  { host: '10.0.0.4:22', keyType: 'ssh-ed25519', fingerprint: 'SHA256:old', pendingFingerprint: 'SHA256:new', origin: 'confirmed', confirmedBy: 'ops@example.com', confirmedAt: '2026-11-01T10:00:00Z' },
  { host: '10.0.0.5', keyType: 'ecdsa-sha2-nistp256', fingerprint: 'SHA256:legacy', pendingFingerprint: null, origin: 'automatic', legacy: true },
]

function seed(keys: unknown[] = KEYS) {
  server.use(http.get('*/api/v1/ssh/host-keys', () => HttpResponse.json({ keys })))
}

const rowOf = (host: string) => screen.getByText(host).closest('tr') as HTMLElement

describe('HostKeysCard', () => {
  it('shows each key with its origin', async () => {
    seed()
    renderWithProviders(<HostKeysCard />)

    expect(await screen.findByText('10.0.0.1:22')).toBeTruthy()
    expect(within(rowOf('10.0.0.1:22')).getByText(/Confirmed by ops@example.com on/)).toBeTruthy()
    expect(within(rowOf('10.0.0.2:22')).getByText('Pinned automatically')).toBeTruthy()
    expect(within(rowOf('10.0.0.3:22')).getByText('Waiting for confirmation')).toBeTruthy()
    expect(within(rowOf('10.0.0.3:22')).getByText('SHA256:pend')).toBeTruthy()
    expect(within(rowOf('10.0.0.4:22')).getByText('Changed, new key waiting')).toBeTruthy()
    // a confirmed key has nothing to trust; a legacy row cannot be trusted by host:port
    expect(within(rowOf('10.0.0.1:22')).queryByRole('button', { name: 'Trust' })).toBeNull()
    expect((within(rowOf('10.0.0.5')).getByRole('button', { name: 'Trust' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('trusts exactly the pending fingerprint shown, after a warning for a changed key', async () => {
    seed()
    let body: unknown
    server.use(http.post('*/api/v1/ssh/host-keys/confirm', async ({ request }) => {
      body = await request.json()

      return HttpResponse.json({ status: 'confirmed' })
    }))
    renderWithProviders(<HostKeysCard />)
    await screen.findByText('10.0.0.4:22')

    fireEvent.click(within(rowOf('10.0.0.4:22')).getByRole('button', { name: 'Trust' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/presents a different key/)).toBeTruthy()
    expect(within(dialog).getByText('ssh-ed25519 key SHA256:new')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trust the key' }))

    expect(await screen.findByText('Host key of 10.0.0.4:22 trusted.')).toBeTruthy()
    expect(body).toEqual({ host: '10.0.0.4:22', fingerprint: 'SHA256:new' })
  })

  it('confirms an automatic pin with its own fingerprint', async () => {
    seed()
    let body: unknown
    server.use(http.post('*/api/v1/ssh/host-keys/confirm', async ({ request }) => {
      body = await request.json()

      return HttpResponse.json({ status: 'confirmed' })
    }))
    renderWithProviders(<HostKeysCard />)
    await screen.findByText('10.0.0.2:22')

    fireEvent.click(within(rowOf('10.0.0.2:22')).getByRole('button', { name: 'Trust' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Trust the key' }))
    await waitFor(() => expect(body).toEqual({ host: '10.0.0.2:22', fingerprint: 'SHA256:auto' }))
  })

  it('forgets a host and reports a failure', async () => {
    seed()
    let deleted = ''
    server.use(http.delete('*/api/v1/ssh/host-keys/:host', ({ params }) => {
      deleted = String(params.host)

      return HttpResponse.json({ error: 'no host key for 10.0.0.3:22' }, { status: 404 })
    }))
    renderWithProviders(<HostKeysCard />)
    await screen.findByText('10.0.0.3:22')

    fireEvent.click(within(rowOf('10.0.0.3:22')).getByRole('button', { name: 'Forget' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Forget the key' }))

    expect(await screen.findByText('The action failed: no host key for 10.0.0.3:22')).toBeTruthy()
    expect(deleted).toBe('10.0.0.3:22')
  })

  it('says when there is no key and when the list cannot be read', async () => {
    seed([])
    renderWithProviders(<HostKeysCard />)
    expect(await screen.findByText('No SSH host key yet.')).toBeTruthy()
    cleanup()

    server.use(http.get('*/api/v1/ssh/host-keys', () => HttpResponse.json({}, { status: 500 })))
    renderWithProviders(<HostKeysCard />)
    expect(await screen.findByText('Unable to load the SSH host keys.')).toBeTruthy()
  })

  it('pages beyond ten keys', async () => {
    seed(Array.from({ length: 12 }, (_, i) => ({ host: `10.1.0.${i + 1}:22`, keyType: 'ssh-ed25519', fingerprint: `SHA256:k${i}`, pendingFingerprint: null, origin: 'automatic' })))
    renderWithProviders(<HostKeysCard />)
    expect(await screen.findByText('10.1.0.1:22')).toBeTruthy()
    expect(screen.queryByText('10.1.0.11:22')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('10.1.0.11:22')).toBeTruthy()
  })
})
