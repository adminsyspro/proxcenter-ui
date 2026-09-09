import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import AttachPbsStorageDialog from './AttachPbsStorageDialog'

const CLUSTER_ID = 'cluster-1'
const STORAGE_URL = `*/api/v1/connections/${CLUSTER_ID}/storage`
// `baseUrl` is what the duplicate check derives the host from, the same host
// PVE stores in a pbs: storage `server` field.
const backupServers = [
  { id: 'pbs-1', name: 'Primary backup server', baseUrl: 'https://pbs.lab:8007', fingerprint: 'AA:BB:CC' },
  { id: 'pbs-2', name: 'Secondary backup server', baseUrl: 'https://pbs2.lab:8007', fingerprint: 'DD:EE:FF' },
  { id: 'pbs-no-fingerprint', name: 'Untrusted backup server', baseUrl: 'https://pbs3.lab:8007', fingerprint: null },
]
const datastores = [
  { name: 'S3manu', comment: 'Daily backups' },
  { name: 'Archive', comment: 'Long-term backups' },
]

function makeProps() {
  return {
    open: true,
    cluster: { id: CLUSTER_ID, name: 'Production' },
    onAttached: vi.fn(),
    onClose: vi.fn(),
  }
}

// The standalone MUI Select labels have no labelId association. Locate the
// visible label's form control, then interact with its actual combobox.
function selectField(label: string) {
  const control = screen.getByText(label, { selector: 'label' }).closest('.MuiFormControl-root')
  if (!control) throw new Error(`Missing form control: ${label}`)
  return within(control as HTMLElement).getByRole('combobox')
}

async function choose(label: string, option: string | RegExp) {
  const field = selectField(label)
  await waitFor(() => expect(field).not.toHaveAttribute('aria-disabled', 'true'))
  fireEvent.mouseDown(field)
  fireEvent.click(await screen.findByRole('option', { name: option }))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
}

async function chooseDatastore() {
  await choose('Backup server', 'Primary backup server')
  await choose('Datastore', /S3manu/)
}

async function chooseNodes() {
  fireEvent.mouseDown(selectField('Nodes'))
  fireEvent.click(await screen.findByRole('option', { name: 'pve1' }))
  fireEvent.click(screen.getByRole('option', { name: 'pve2' }))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
}

beforeEach(() => {
  server.use(
    http.get('*/api/v1/connections', () => HttpResponse.json({ data: backupServers })),
    http.get(`*/api/v1/connections/${CLUSTER_ID}/nodes`, () =>
      HttpResponse.json({ data: [{ node: 'pve1' }, { node: 'pve2' }] }),
    ),
    http.get(STORAGE_URL, () => HttpResponse.json({ data: [
      { type: 'pbs', storage: 'existing-backup', server: 'backup.example', datastore: 'Existing' },
    ] })),
    http.get('*/api/v1/pbs/:id/datastores', () => HttpResponse.json({ data: datastores })),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AttachPbsStorageDialog', () => {
  it('defaults to Proxmox Backup Server without a cluster field', async () => {
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await waitFor(() => expect(screen.queryByText(/No backup server is registered yet/)).not.toBeInTheDocument())

    expect(selectField('Storage type')).toHaveTextContent('Proxmox Backup Server')
    expect(screen.queryByLabelText(/^Cluster$/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Cluster', { selector: 'label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /cluster/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(4)
  })

  it('requests registered PBS connections and offers exactly those servers, without manual entry', async () => {
    const connectionQuery = vi.fn()
    server.use(http.get('*/api/v1/connections', ({ request }) => {
      connectionQuery(new URL(request.url).searchParams.get('type'))
      return HttpResponse.json({ data: backupServers })
    }))
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    fireEvent.mouseDown(selectField('Backup server'))
    await screen.findByRole('option', { name: 'Primary backup server' })

    expect(connectionQuery).toHaveBeenCalledExactlyOnceWith('pbs')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(backupServers.map(server => server.name))
    expect(screen.queryByRole('option', { name: /manual|custom|other|enter|hand.typed/i })).not.toBeInTheDocument()
  })

  it('loads and lists the datastores of the selected backup server', async () => {
    const loadDatastores = vi.fn()
    server.use(http.get('*/api/v1/pbs/:id/datastores', ({ params }) => {
      loadDatastores(params.id)
      return HttpResponse.json({ data: datastores })
    }))
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    expect(loadDatastores).not.toHaveBeenCalled()
    expect(selectField('Datastore')).toHaveAttribute('aria-disabled', 'true')

    await choose('Backup server', 'Secondary backup server')
    await waitFor(() => expect(selectField('Datastore')).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.mouseDown(selectField('Datastore'))

    expect(await screen.findByRole('option', { name: 'S3manu Daily backups' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Archive Long-term backups' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(loadDatastores).toHaveBeenCalledExactlyOnceWith('pbs-2')
  })

  it('derives the storage name from the datastore until the operator edits it', async () => {
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await chooseDatastore()
    const name = screen.getByRole('textbox', { name: 'Storage name' })
    expect(name).toHaveValue('pbs-s3manu')

    await choose('Datastore', /Archive/)
    expect(name).toHaveValue('pbs-archive')
    fireEvent.change(name, { target: { value: 'my-backups' } })
    await choose('Datastore', /S3manu/)
    expect(name).toHaveValue('my-backups')
  })

  it('still renders when every listing endpoint fails', async () => {
    // The dialog is the only way in, so a backend hiccup must leave a usable
    // form with empty lists rather than a blank or broken dialog.
    server.use(
      http.get('*/api/v1/connections', () => new HttpResponse(null, { status: 500 })),
      http.get(`*/api/v1/connections/${CLUSTER_ID}/nodes`, () => new HttpResponse(null, { status: 500 })),
      http.get(STORAGE_URL, () => new HttpResponse(null, { status: 500 })),
    )
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)

    expect(await screen.findByText('Add a storage')).toBeInTheDocument()
    expect(await screen.findByText(/No backup server is registered yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('marks a name taken by a NON-PBS storage as invalid too', async () => {
    // `local`, a Ceph pool or a ZFS pool hold their name on the cluster just
    // like a pbs: entry does. Warning here beats letting PVE answer 409 after
    // the operator has filled the whole form.
    server.use(http.get(STORAGE_URL, () => HttpResponse.json({ data: [
      { type: 'dir', storage: 'local', server: null, datastore: null },
    ] })))
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await chooseDatastore()
    const name = screen.getByRole('textbox', { name: 'Storage name' })

    fireEvent.change(name, { target: { value: 'local' } })

    expect(await screen.findByText('A storage already uses this name on the cluster.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('flags an already attached datastore only when the backup server matches', async () => {
    // Two backup servers can expose a datastore of the same name, so the
    // warning is keyed on the pair, not on the datastore name alone.
    server.use(http.get(STORAGE_URL, () => HttpResponse.json({ data: [
      { type: 'pbs', storage: 'pbs-elsewhere', server: 'other.example', datastore: 'S3manu' },
    ] })))
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await chooseDatastore()

    expect(screen.queryByText(/already attached to the cluster/i)).not.toBeInTheDocument()

    cleanup()
    server.use(http.get(STORAGE_URL, () => HttpResponse.json({ data: [
      { type: 'pbs', storage: 'pbs-same', server: 'pbs.lab', datastore: 'S3manu' },
    ] })))
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await chooseDatastore()

    expect(await screen.findByText(/already attached to the cluster as pbs-same/i)).toBeInTheDocument()
  })

  it('marks an existing storage name as invalid and blocks submission', async () => {
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await chooseDatastore()
    const name = screen.getByRole('textbox', { name: 'Storage name' })
    fireEvent.change(name, { target: { value: 'existing-backup' } })

    expect(await screen.findByText('A storage already uses this name on the cluster.')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    fireEvent.change(name, { target: { value: 'unique-backup' } })
    expect(name).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('warns and blocks submission when the backup server has no fingerprint', async () => {
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    await choose('Backup server', 'Untrusted backup server')
    await choose('Datastore', /S3manu/)

    const warning = screen.getByText(/This backup server has no captured certificate fingerprint/)
    expect(warning.closest('[role="alert"]')).toHaveClass('MuiAlert-standardWarning')
    expect(screen.getByRole('textbox', { name: 'Storage name' })).toHaveValue('pbs-s3manu')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await chooseDatastore()
    expect(screen.queryByText(/This backup server has no captured certificate fingerprint/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('shows all nodes while empty and the selected nodes after selection', async () => {
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    expect(selectField('Nodes')).toHaveTextContent('All nodes')
    await chooseNodes()

    expect(selectField('Nodes')).toHaveTextContent('pve1, pve2')
    expect(selectField('Nodes')).not.toHaveTextContent('All nodes')
    fireEvent.mouseDown(selectField('Nodes'))
    expect(within(screen.getByRole('option', { name: 'pve1' })).getByRole('checkbox')).toBeChecked()
    expect(within(screen.getByRole('option', { name: 'pve2' })).getByRole('checkbox')).toBeChecked()
  })

  it('posts the exact attachment payload and refreshes before closing', async () => {
    const post = vi.fn()
    server.use(http.post(STORAGE_URL, async ({ request }) => {
      post(await request.json())
      return HttpResponse.json({ data: { storage: 'daily-backups' } })
    }))
    const props = makeProps()
    renderWithProviders(<AttachPbsStorageDialog {...props} />)
    await chooseDatastore()
    fireEvent.change(screen.getByRole('textbox', { name: 'Storage name' }), { target: { value: 'daily-backups' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Namespace' }), { target: { value: 'team/production' } })
    await chooseNodes()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledExactlyOnceWith({
      type: 'pbs',
      storage: 'daily-backups',
      datastore: 'S3manu',
      namespace: 'team/production',
      nodes: ['pve1', 'pve2'],
      pbsConnectionId: 'pbs-1',
    })
    expect(props.onAttached).toHaveBeenCalledTimes(1)
    expect(props.onAttached.mock.invocationCallOrder[0]).toBeLessThan(props.onClose.mock.invocationCallOrder[0])
  })

  it('surfaces a failed POST and leaves the dialog open without callbacks', async () => {
    const post = vi.fn()
    server.use(http.post(STORAGE_URL, () => {
      post()
      return HttpResponse.json({ error: 'Storage was attached by another operator.', code: 'STORAGE_EXISTS' }, { status: 409 })
    }))
    const props = makeProps()
    renderWithProviders(<AttachPbsStorageDialog {...props} />)
    await chooseDatastore()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    const error = await screen.findByText('Storage was attached by another operator.')
    expect(error.closest('[role="alert"]')).toHaveClass('MuiAlert-standardError')
    expect(post).toHaveBeenCalledTimes(1)
    expect(props.onAttached).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add a storage' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('requires both a datastore and a storage name before enabling submission', async () => {
    renderWithProviders(<AttachPbsStorageDialog {...makeProps()} />)
    const submit = screen.getByRole('button', { name: 'Add' })
    expect(submit).toBeDisabled()
    await choose('Backup server', 'Primary backup server')
    expect(submit).toBeDisabled()
    const name = screen.getByRole('textbox', { name: 'Storage name' })
    fireEvent.change(name, { target: { value: 'my-backups' } })
    expect(submit).toBeDisabled()
    await choose('Datastore', /S3manu/)
    expect(submit).toBeEnabled()
    fireEvent.change(name, { target: { value: '' } })
    expect(submit).toBeDisabled()
    fireEvent.change(name, { target: { value: 'my-backups' } })
    expect(submit).toBeEnabled()
  })
})
