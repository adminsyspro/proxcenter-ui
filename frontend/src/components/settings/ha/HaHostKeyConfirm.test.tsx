import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import HaHostKeyConfirm from './HaHostKeyConfirm'

afterEach(cleanup)

const KEYS = [
  { node: 'pxc-ha2', hostKey: { endpoint: '10.0.0.42:22', key_type: 'ssh-ed25519', fingerprint: 'SHA256:new2', state: 'unconfirmed' as const } },
  { node: 'pxc-ha3', hostKey: { endpoint: '10.0.0.43:22', key_type: 'ssh-ed25519', fingerprint: 'SHA256:chg3', state: 'mismatch' as const } },
]

describe('HaHostKeyConfirm', () => {
  it('renders nothing without a refused key', () => {
    const { container } = renderWithProviders(<HaHostKeyConfirm keys={[]} onTrusted={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('shows each fingerprint and trusts exactly the key shown, then re-runs the validation', async () => {
    let body: unknown
    server.use(http.post('*/api/v1/ssh/host-keys/confirm', async ({ request }) => {
      body = await request.json()

      return HttpResponse.json({ status: 'confirmed' })
    }))
    const onTrusted = vi.fn()
    renderWithProviders(<HaHostKeyConfirm keys={KEYS} onTrusted={onTrusted} />)

    expect(screen.getByText('pxc-ha2: host key not confirmed yet')).toBeTruthy()
    expect(screen.getByText('pxc-ha3: host key changed since it was trusted')).toBeTruthy()
    // the whole fingerprint is shown, on its own line, for the operator to compare
    expect(screen.getByText('ssh-ed25519 key SHA256:new2')).toBeTruthy()
    expect(screen.getByText('ssh-ed25519 key SHA256:chg3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Trust this key/ }))
    await waitFor(() => expect(onTrusted).toHaveBeenCalledTimes(1))
    expect(body).toEqual({ host: '10.0.0.42:22', fingerprint: 'SHA256:new2' })
    expect(screen.getByRole('button', { name: /Trust the new key/ })).toBeTruthy()
  })

  it('shows why a key was not trusted and does not re-run the validation', async () => {
    server.use(http.post('*/api/v1/ssh/host-keys/confirm', () =>
      HttpResponse.json({ error: '10.0.0.43:22 has no key with fingerprint SHA256:chg3' }, { status: 404 })))
    const onTrusted = vi.fn()
    renderWithProviders(<HaHostKeyConfirm keys={KEYS} onTrusted={onTrusted} />)

    fireEvent.click(screen.getByRole('button', { name: /Trust the new key/ }))
    expect(await screen.findByText(/The key was not trusted: 10.0.0.43:22 has no key/)).toBeTruthy()
    expect(onTrusted).not.toHaveBeenCalled()
  })

  it('reports a network failure', async () => {
    server.use(http.post('*/api/v1/ssh/host-keys/confirm', () => HttpResponse.error()))
    renderWithProviders(<HaHostKeyConfirm keys={KEYS.slice(0, 1)} onTrusted={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Trust this key/ }))
    expect(await screen.findByText(/The key was not trusted/)).toBeTruthy()
  })

  it('disables the buttons while the validation runs', () => {
    renderWithProviders(<HaHostKeyConfirm keys={KEYS} onTrusted={() => {}} disabled />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })
})
