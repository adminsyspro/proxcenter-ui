/**
 * ClusterStorageDialog (roadmap#202): the body a create or an edit sends, the
 * connection test, the LVM-on-iSCSI base, the hand-over from the PBS dialog,
 * and RemoveClusterStorageDialog's refusals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import AttachPbsStorageDialog from './AttachPbsStorageDialog'
import ClusterStorageDialog from './ClusterStorageDialog'
import RemoveClusterStorageDialog from './RemoveClusterStorageDialog'

afterEach(() => cleanup())

const CLUSTER = { id: 'c1', name: 'Production' }
const BASE = '*/api/v1/connections/c1'

function backend(opts: { config?: any; scan?: (body: any) => Response; save?: (body: any) => Response } = {}) {
  const calls: Array<{ method: string; url: string; body: any }> = []

  server.use(
    http.get(`${BASE}/nodes`, () => HttpResponse.json({ data: [{ node: 'pve2' }, { node: 'pve1' }] })),
    http.get(`${BASE}/storage`, () => HttpResponse.json({ data: [{ storage: 'local', type: 'dir' }, { storage: 'san', type: 'iscsi' }] })),
    http.get(`${BASE}/storage/:sid`, () => HttpResponse.json({ data: opts.config })),
    http.get(`${BASE}/nodes/:node/storage/san/content`, () => HttpResponse.json({ data: [{ volid: 'san:0.0.0.scsi-1', size: 2 ** 31 }] })),
    http.post(`${BASE}/nodes/:node/storage-scan`, async ({ request, params }) => {
      const body = await request.json()
      calls.push({ method: 'SCAN', url: String(params.node), body })
      return opts.scan ? opts.scan(body) : HttpResponse.json({ data: [{ value: '/srv/export', detail: '10.0.0.0/24' }] })
    }),
    http.post(`${BASE}/storage`, async ({ request }) => {
      const body = await request.json()
      calls.push({ method: 'POST', url: 'storage', body })
      return opts.save ? opts.save(body) : HttpResponse.json({ data: {} }, { status: 201 })
    }),
    http.put(`${BASE}/storage/:sid`, async ({ request, params }) => {
      const body = await request.json()
      calls.push({ method: 'PUT', url: String(params.sid), body })
      return opts.save ? opts.save(body) : HttpResponse.json({ data: {} })
    }),
  )

  return calls
}

const field = (label: RegExp | string) => screen.getByLabelText(label)
const type = (label: RegExp | string, value: string) => fireEvent.change(field(label), { target: { value } })

async function choose(label: string, option: string | RegExp) {
  const combo = await screen.findByRole('combobox', { name: label })
  fireEvent.mouseDown(combo)
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

function open(props: Partial<React.ComponentProps<typeof ClusterStorageDialog>> = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const onTypeChange = vi.fn()

  renderWithProviders(<ClusterStorageDialog cluster={CLUSTER} mode="create" onSaved={onSaved} onClose={onClose} onTypeChange={onTypeChange} {...props} />)

  return { onSaved, onClose, onTypeChange }
}

describe('ClusterStorageDialog: create', () => {
  it('tests an NFS server, picks the export and creates the storage', async () => {
    const calls = backend()
    const { onSaved, onClose } = open()

    type(/Storage name/, 'nfs-1')
    type(/Server/, '10.0.0.5')
    const test = screen.getByRole('button', { name: /Test connection/ })
    await waitFor(() => expect(test).toBeEnabled())
    fireEvent.click(test)
    expect(await screen.findByText('1 entry found')).toBeInTheDocument()
    fireEvent.mouseDown(field(/Export/))
    fireEvent.click(await screen.findByRole('option', { name: '/srv/export' }))
    fireEvent.click(screen.getByRole('button', { name: /Bandwidth limits/ }))
    type('Default', '50')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(calls[0]).toEqual({ method: 'SCAN', url: 'pve1', body: { type: 'nfs', server: '10.0.0.5' } })
    expect(calls[1].body).toEqual({
      type: 'nfs', storage: 'nfs-1', fields: { server: '10.0.0.5', export: '/srv/export' }, content: ['images'], nodes: [], enabled: true, bwlimit: { default: 50 },
    })
  })

  it('shows a refused connection test and keeps Create off without the required fields', async () => {
    backend({ scan: () => HttpResponse.json({ error: 'unexpected status: NT_STATUS_ACCESS_DENIED' }, { status: 422 }) })
    open({ initialType: 'cifs' })

    type(/Server/, 's')
    type(/User name/, 'u')
    type(/Password/, 'bad')
    const test = screen.getByRole('button', { name: /Test connection/ })
    await waitFor(() => expect(test).toBeEnabled())
    fireEvent.click(test)

    expect(await screen.findByText('unexpected status: NT_STATUS_ACCESS_DENIED')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('refuses a name already taken or malformed', async () => {
    backend()
    open({ initialType: 'dir' })

    type(/Storage name/, 'local')
    expect(await screen.findByText('A storage already uses this name on the cluster.')).toBeInTheDocument()
    type(/Storage name/, '1bad')
    expect(screen.getByText('Starts with a letter; letters, digits, -, _ and . only')).toBeInTheDocument()
  })

  it('builds an LVM on a LUN of an iSCSI storage', async () => {
    const calls = backend()
    open({ initialType: 'lvm' })

    type(/Storage name/, 'vg-san')
    await choose('Base storage', 'san')
    await choose('Base volume (LUN)', /0\.0\.0\.scsi-1/)
    type(/Volume group/, 'vgsan')
    fireEvent.click(screen.getByLabelText(/Shared/))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeDefined())
    expect(calls.find(c => c.method === 'POST')!.body).toMatchObject({
      type: 'lvm', storage: 'vg-san', fields: { base: 'san:0.0.0.scsi-1', vgname: 'vgsan' }, shared: true,
    })
  })

  it('keeps `none` alone for an iSCSI kept for an LVM', async () => {
    const calls = backend()
    open({ initialType: 'iscsi' })

    type(/Storage name/, 'san2')
    type(/Portal/, '10.0.0.9')
    type(/Target/, 'iqn.x')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Content' }))
    fireEvent.click(await screen.findByRole('option', { name: /None \(kept for an LVM\)/ }))
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(calls.find(c => c.method === 'POST')).toBeDefined())
    expect(calls.find(c => c.method === 'POST')!.body.content).toEqual(['none'])
  })

  it('shows the hints of the types Proxmox cannot test, and the LIO field only for LIO', async () => {
    backend()
    open({ initialType: 'zfs' })

    expect(screen.getByText(/reaches the ZFS target over SSH/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Target portal group/)).not.toBeInTheDocument()
    await choose('iSCSI provider', 'LIO')
    expect(screen.getByLabelText(/Target portal group/)).toBeInTheDocument()
  })

  it('hands PBS back to its own dialog, and shows a save error', async () => {
    backend({ save: () => HttpResponse.json({ error: 'storage ID already defined' }, { status: 500 }) })
    const { onTypeChange } = open({ initialType: 'rbd' })

    expect(screen.getByText(/no connection test for an external Ceph/)).toBeInTheDocument()
    type(/Storage name/, 'ext')
    type(/Monitors/, 'm1')
    type(/^Pool/, 'rbd')
    type(/User name/, 'admin')
    type(/Keyring/, 'key')
    fireEvent.click(screen.getByLabelText(/Use KRBD/))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('storage ID already defined')).toBeInTheDocument()

    await choose('Storage type', 'Proxmox Backup Server')
    expect(onTypeChange).toHaveBeenCalledWith('pbs')
  })
})

describe('ClusterStorageDialog: edit', () => {
  it('reads the config, greys the fixed fields and sends the change', async () => {
    const calls = backend({ config: { type: 'cifs', storage: 'smb', server: 's', share: 'x', username: 'u', content: 'iso,backup', nodes: 'pve1', disable: 1, bwlimit: 'restore=102400' } })
    const { onSaved } = open({ mode: 'edit', storage: 'smb' })

    expect(await screen.findByDisplayValue('u')).toBeInTheDocument()
    expect(field(/Server/)).toBeDisabled()
    expect(field(/Password/)).toHaveAttribute('placeholder', 'Leave empty to keep the stored value')
    fireEvent.click(screen.getByRole('button', { name: /Bandwidth limits/ }))
    expect(field('Restore')).toHaveValue(100)
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'smb', body: { content: ['iso', 'backup'], nodes: ['pve1'], enabled: true, bwlimit: { restore: 100 } } })
  })

  it('shows a config that cannot be read', async () => {
    server.use(http.get(`${BASE}/storage/:sid`, () => HttpResponse.json({ error: 'no such storage' }, { status: 404 })))
    backend()
    server.use(http.get(`${BASE}/storage/:sid`, () => HttpResponse.json({ error: 'no such storage' }, { status: 404 })))
    open({ mode: 'edit', storage: 'gone' })

    expect(await screen.findByText('no such storage')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('AttachPbsStorageDialog hands the other types over', () => {
  it('opens the cluster storage form for NFS and comes back for PBS', async () => {
    backend()
    server.use(http.get('*/api/v1/connections', () => HttpResponse.json({ data: [] })))
    renderWithProviders(<AttachPbsStorageDialog open cluster={CLUSTER} onClose={vi.fn()} onAttached={vi.fn()} />)

    await choose('Storage type', 'NFS')
    expect(await screen.findByLabelText(/Export/)).toBeInTheDocument()
    await choose('Storage type', 'Proxmox Backup Server')
    expect(await screen.findByRole('combobox', { name: 'Backup server' })).toBeInTheDocument()
  })
})

describe('RemoveClusterStorageDialog', () => {
  function remove(reply: (force: boolean) => Response) {
    const calls: boolean[] = []
    server.use(http.delete(`${BASE}/storage/:sid`, ({ request }) => {
      const force = new URL(request.url).searchParams.get('force') === '1'
      calls.push(force)
      return reply(force)
    }))
    const onRemoved = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<RemoveClusterStorageDialog target={{ connId: 'c1', storage: 'nfs1' }} onClose={onClose} onRemoved={onRemoved} />)
    return { calls, onRemoved, onClose }
  }

  it('removes a storage nothing uses', async () => {
    const { onRemoved, onClose } = remove(() => HttpResponse.json({ data: { removed: true } }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('says what still uses it and keeps Delete off', async () => {
    remove(() => HttpResponse.json({ code: 'STORAGE_IN_USE', vmids: [101, 102], backupJobs: ['job1'], storages: ['lvm1'] }, { status: 409 }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Guests: 101, 102')).toBeInTheDocument()
    expect(screen.getByText('Backup jobs: job1')).toBeInTheDocument()
    expect(screen.getByText('Storages built on it: lvm1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('offers to remove it anyway when a node could not be read', async () => {
    const { calls, onRemoved } = remove(force => (force
      ? HttpResponse.json({ data: { removed: true } })
      : HttpResponse.json({ code: 'STORAGE_USAGE_UNVERIFIED', unverified: ['pve2'] }, { status: 409 })))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove anyway' }))

    await waitFor(() => expect(onRemoved).toHaveBeenCalled())
    expect(calls).toEqual([false, true])
  })

  it('shows any other error', async () => {
    remove(() => HttpResponse.json({ error: 'boom' }, { status: 500 }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
})
