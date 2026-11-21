import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import DeleteConnectionDialog, { usageConflictOf } from './DeleteConnectionDialog'

afterEach(cleanup)

const unused = { blocking: {}, apiTokens: [] }

function stubUsage(body: unknown, status = 200) {
  server.use(http.get('/api/v1/connections/:id/usage', () => HttpResponse.json(body as any, { status })))
}

function renderDialog(props: Partial<Parameters<typeof DeleteConnectionDialog>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()

  renderWithProviders(
    <DeleteConnectionDialog open connectionId='dr' typeName='PVE' deleting={false} conflict={null} error={null} onCancel={onCancel} onConfirm={onConfirm} {...props} />
  )

  return { onCancel, onConfirm }
}

describe('DeleteConnectionDialog', () => {
  it('asks for confirmation once nothing uses the connection, and deletes on confirm', async () => {
    stubUsage(unused)
    const { onConfirm } = renderDialog()

    expect(screen.getByText('Delete this PVE connection?')).toBeInTheDocument()
    const del = screen.getByRole('button', { name: 'Delete' })
    expect(del).toBeDisabled()
    expect(await screen.findByText(/Are you sure/)).toBeInTheDocument()
    expect(del).not.toBeDisabled()
    await userEvent.click(del)
    expect(onConfirm).toHaveBeenCalled()
  })

  it('lists every link in a subsection per kind, with its icon, count and items, and blocks the deletion (ui#1394)', async () => {
    stubUsage({
      blocking: { tenantOwner: ['MSP'], vdcs: ['MSP-DR (MSP)'], replicationJobs: ['Web', 'DB'], microseg: ['PVE-DR', 'PVE-PROD'] },
      apiTokens: [],
    })
    renderDialog()

    expect(await screen.findByText(/still in use/)).toBeInTheDocument()
    const jobs = screen.getByRole('group', { name: 'Site Recovery replication jobs' })
    expect(jobs.querySelector('.ri-refresh-line')).toBeInTheDocument()
    expect(within(jobs).getByText('2')).toBeInTheDocument()
    expect(within(jobs).getByText('Web')).toBeInTheDocument()
    expect(within(jobs).getByText('DB')).toBeInTheDocument()
    const vdcs = screen.getByRole('group', { name: 'Virtual datacenters' })
    expect(vdcs.querySelector('.ri-cloud-line')).toBeInTheDocument()
    expect(within(vdcs).getByText('MSP-DR (MSP)')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Owned by tenant' }).querySelector('.ri-building-line')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Micro-segmentation policy (clusters)' }).querySelector('.ri-shield-flash-line')).toBeInTheDocument()
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual([
      'Owned by tenant', 'Virtual datacenters', 'Site Recovery replication jobs', 'Micro-segmentation policy (clusters)',
    ])
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('warns about API tokens limited to the connection in their own subsection, without blocking', async () => {
    stubUsage({ blocking: {}, apiTokens: ['ci'] })
    renderDialog()

    const tokens = await screen.findByRole('group', { name: 'API tokens limited to this connection' })
    expect(tokens.querySelector('.ri-code-box-line')).toBeInTheDocument()
    expect(within(tokens).getByText('ci')).toBeInTheDocument()
    expect(screen.getByText(/will no longer reach anything/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
  })

  it('shows the links of a 409 even if they appeared after the dialog opened', async () => {
    stubUsage(unused)
    renderDialog({ conflict: { blocking: { migrations: ['web-01'] }, apiTokens: [] } })

    expect(within(await screen.findByRole('group', { name: 'Migrations in progress' })).getByText('web-01')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('lets the server decide when the links cannot be read', async () => {
    stubUsage({ error: 'boom' }, 500)
    renderDialog()

    expect(await screen.findByText(/Are you sure/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
  })

  it('shows any other failure and cannot be cancelled while the deletion runs', async () => {
    stubUsage(unused)
    renderDialog({ error: 'boom', deleting: true })

    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})

describe('usageConflictOf', () => {
  it('reads the links from a 409 body', () => {
    const usage = { blocking: { vdcs: ['A'] }, apiTokens: [] }

    expect(usageConflictOf({ code: 'CONNECTION_IN_USE', usage })).toEqual(usage)
  })

  it('returns null for any other error body', () => {
    expect(usageConflictOf({ error: 'boom' })).toBeNull()
    expect(usageConflictOf(null)).toBeNull()
  })
})
