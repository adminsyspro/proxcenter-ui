/**
 * The SSH test of an existing connection shows the host key a node presented
 * when it was refused, and trusts exactly that key before testing again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => ({ hasFeature: () => false }),
  Features: { VMWARE_MIGRATION: 'vmware_migration' },
}))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: false, currentTenant: { id: 'default' }, tenants: [] }),
}))

import ConnectionDialog from './ConnectionDialog'

const REFUSED = {
  success: false,
  nodes: [{
    node: 'esx1', ip: '10.0.0.21', host: '10.0.0.21', port: 22, status: 'error', error: 'not confirmed',
    host_key: { endpoint: '10.0.0.21:22', key_type: 'ecdsa-sha2-nistp256', fingerprint: 'SHA256:abc', state: 'unconfirmed' },
  }],
}
const OK = { success: true, nodes: [{ node: 'esx1', ip: '10.0.0.21', host: '10.0.0.21', port: 22, status: 'ok' }] }

function stubFetch(confirm: { ok: boolean; body: unknown }) {
  const tests: unknown[] = [REFUSED, OK]
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/test-ssh')) return { ok: true, json: async () => tests.shift() ?? OK }
    if (url === '/api/v1/ssh/host-keys/confirm') return { ok: confirm.ok, status: confirm.ok ? 200 : 404, json: async () => confirm.body }

    return { ok: true, json: async () => ({ data: [] }) }
  })
  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

function openSshTest() {
  renderWithProviders(
    <ConnectionDialog
      open onClose={vi.fn()} onSave={vi.fn()} type="vmware" mode="edit"
      initialData={{ id: 'conn-esx', name: 'ESXi', baseUrl: 'https://10.0.0.21', sshEnabled: true, sshPort: 22, sshUser: 'root', sshAuthMethod: 'password', sshPassConfigured: true } as any}
    />,
  )
  fireEvent.click(screen.getByRole('tab', { name: /SSH/ }))
  fireEvent.click(screen.getByRole('button', { name: /Test SSH Connection/ }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConnectionDialog host key trust', () => {
  it('shows the refused key and trusts exactly that fingerprint, then tests again', async () => {
    const fetchMock = stubFetch({ ok: true, body: { status: 'confirmed' } })
    openSshTest()

    expect(await screen.findByText(/ecdsa-sha2-nistp256 key SHA256:abc/)).toBeTruthy()
    expect(screen.getByText(/host key not confirmed yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Trust this key/ }))

    await waitFor(() => expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/test-ssh'))).toHaveLength(2))
    const confirm = fetchMock.mock.calls.find(c => c[0] === '/api/v1/ssh/host-keys/confirm')!
    expect(JSON.parse(String(confirm[1]?.body))).toEqual({ host: '10.0.0.21:22', fingerprint: 'SHA256:abc' })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Trust this key/ })).toBeNull())
  })

  it('keeps the key and says why when it could not be trusted', async () => {
    const fetchMock = stubFetch({ ok: false, body: { error: '10.0.0.21:22 has no key with fingerprint SHA256:abc' } })
    openSshTest()

    fireEvent.click(await screen.findByRole('button', { name: /Trust this key/ }))
    const dialog = screen.getAllByRole('dialog')[0]
    expect(await within(dialog).findByText(/The key was not trusted: 10.0.0.21:22 has no key/)).toBeTruthy()
    expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/test-ssh'))).toHaveLength(1)
  })
})
