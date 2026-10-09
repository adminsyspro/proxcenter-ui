/**
 * Component tests for ConnectionCheckDialog.tsx
 *
 * The dialog POSTs /api/v1/connections/:id/check on open and renders one line
 * per item, the hint translated from the real en.json with the params
 * interpolated (feature ids turned into their names).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { HttpResponse, http, server } from '@/__tests__/setup/msw-server'
import type { CheckItem } from '@/lib/connections/check/types'

import ConnectionCheckDialog from './ConnectionCheckDialog'

const CONN_ID = 'conn-1'

const ITEMS: CheckItem[] = [
  { id: 'api.primary', probe: 'api', status: 'ok', hint: 'api.ok', params: { host: '10.42.0.101', latencyMs: 42, version: '9.2.11' } },
  { id: 'api.fallback.pve2', probe: 'api', status: 'warn', hint: 'api.fallbackUnreachable', params: { node: 'pve2', host: '10.42.0.102', error: 'EHOSTUNREACH' } },
  {
    id: 'privileges.guest-console',
    probe: 'privileges',
    status: 'warn',
    hint: 'privileges.missing',
    params: { privileges: 'VM.Console', path: '/vms', features: ['console', 'snapshots'], tokenId: 'u@pve!t', user: 'u@pve', command: "pveum aclmod /vms -user u@pve -role PVEAdmin ; pveum aclmod /vms -token 'u@pve!t' -role PVEAdmin" },
  },
  { id: 'quorum', probe: 'quorum', status: 'fail', hint: 'quorum.lost', params: { cluster: 'lab', online: 1, total: 3 } },
  { id: 'ssh', probe: 'ssh', status: 'skip', hint: 'ssh.disabled', params: {} },
]

function seed(items: CheckItem[] = ITEMS) {
  const calls: number[] = []
  server.use(
    http.post(`*/api/v1/connections/${CONN_ID}/check`, () => {
      calls.push(1)
      return HttpResponse.json({ items })
    }),
  )
  return calls
}

function makeProps(overrides: Partial<Parameters<typeof ConnectionCheckDialog>[0]> = {}) {
  return { open: true, connectionId: CONN_ID, connectionName: 'lab', onClose: vi.fn(), ...overrides }
}

afterEach(() => cleanup())

describe('ConnectionCheckDialog', () => {
  it('renders nothing when closed', () => {
    renderWithProviders(<ConnectionCheckDialog {...makeProps({ open: false })} />)
    expect(screen.queryByText('Check connection')).not.toBeInTheDocument()
  })

  it('runs the check on open and renders every item with its translated hint', async () => {
    seed()
    renderWithProviders(<ConnectionCheckDialog {...makeProps()} />)

    await waitFor(() => expect(screen.getByTestId('check-item-api.primary')).toBeInTheDocument())
    expect(screen.getByText('10.42.0.101 answered in 42 ms (Proxmox VE 9.2.11).')).toBeInTheDocument()
    expect(screen.getByText('pve2 (10.42.0.102)')).toBeInTheDocument()
    expect(screen.getByText(/Fallback pve2 \(10\.42\.0\.102\) is unreachable \(EHOSTUNREACH\)/)).toBeInTheDocument()
    // Feature ids are translated and joined.
    expect(screen.getByText(/VM\.Console missing on \/vms\. Impacted: VM and container consoles, snapshots\./)).toBeInTheDocument()
    expect(screen.getByText(/Cluster lab has lost quorum \(1\/3 nodes online\)/)).toBeInTheDocument()
    expect(screen.getByText('SSH is not enabled on this connection.')).toBeInTheDocument()

    // Summary chips.
    expect(screen.getByText('1 OK')).toBeInTheDocument()
    expect(screen.getByText('2 warnings')).toBeInTheDocument()
    expect(screen.getByText('1 failure')).toBeInTheDocument()
    expect(screen.getByText('1 skipped')).toBeInTheDocument()
    expect(screen.queryByText('All checks passed.')).not.toBeInTheDocument()
  })

  it('shows the success banner when nothing warns or fails, and re-runs on demand', async () => {
    const calls = seed([{ id: 'quorum', probe: 'quorum', status: 'ok', hint: 'quorum.standalone', params: {} }])
    renderWithProviders(<ConnectionCheckDialog {...makeProps()} />)

    await waitFor(() => expect(screen.getByText('All checks passed.')).toBeInTheDocument())
    expect(calls).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Re-run/ }))
    await waitFor(() => expect(calls).toHaveLength(2))
    await waitFor(() => expect(screen.getByText('All checks passed.')).toBeInTheDocument())
  })

  it('falls back to the raw code for an unknown hint', async () => {
    seed([{ id: 'api.primary', probe: 'api', status: 'fail', hint: 'api.somethingNew', params: { host: 'h' } }])
    renderWithProviders(<ConnectionCheckDialog {...makeProps()} />)
    await waitFor(() => expect(screen.getByText('api.somethingNew')).toBeInTheDocument())
  })

  it('surfaces a server error', async () => {
    server.use(http.post(`*/api/v1/connections/${CONN_ID}/check`, () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })))
    renderWithProviders(<ConnectionCheckDialog {...makeProps()} />)
    await waitFor(() => expect(screen.getByText(/Check unavailable: forbidden/)).toBeInTheDocument())
  })
})
