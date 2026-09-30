/**
 * Component tests for StorageContentBrowser.tsx: the content list is fetched
 * on mount and refetched after a delete, an upload or a download-from-URL,
 * and the upload dialog's submit dispatches on its mode.
 *
 * The chunked upload client and the task bar context are mocked: their own
 * protocol is covered elsewhere, what matters here is what the dialog hands
 * them. The storage content, delete and download-url routes are served by MSW.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  userEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

const h = vi.hoisted(() => ({
  uploadFileToStorage: vi.fn(),
  tasks: {
    addTask: vi.fn(),
    updateTask: vi.fn(),
    registerOnRestore: vi.fn(),
    unregisterOnRestore: vi.fn(),
    registerOnCancel: vi.fn(),
    unregisterOnCancel: vi.fn(),
  },
}))

vi.mock('@/lib/storage/uploadClient', () => ({ uploadFileToStorage: h.uploadFileToStorage }))
vi.mock('@/contexts/ProxCenterTasksContext', () => ({ useProxCenterTasks: () => h.tasks }))
vi.mock('@/components/storage/TemplateDownloadDialog', () => ({ default: () => null }))

import StorageContentBrowser from './StorageContentBrowser'

const CONN = 'conn-1'
const NODE = 'pve1'
const STORAGE = 'local'
const BASE = `*/api/v1/connections/${CONN}/nodes/${NODE}/storage/${STORAGE}`

const ISO_URL = 'https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.1.0-amd64-netinst.iso'

let contentCalls = 0
let items: Array<Record<string, unknown>> = []

function seedContent() {
  contentCalls = 0
  items = [
    { volid: 'local:iso/virtio-win-0.1.271.iso', content: 'iso', size: 700 * 1024 * 1024, ctime: 2 },
    { volid: 'local:iso/ubuntu-24.04.3-live-server-amd64.iso', content: 'iso', size: 3 * 1024 * 1024 * 1024, ctime: 1 },
  ]
  server.use(
    http.get(`${BASE}/content`, () => {
      contentCalls += 1

      return HttpResponse.json({ data: items })
    }),
  )
}

function renderBrowser(onDelete = vi.fn()) {
  renderWithProviders(
    <StorageContentBrowser connId={CONN} node={NODE} storage={STORAGE} contentTypes={['iso']} onDelete={onDelete} />,
  )

  return onDelete
}

describe('StorageContentBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedContent()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('loads the storage content on mount and lists the file names, newest first', async () => {
    renderBrowser()

    await waitFor(() => expect(screen.getByText('virtio-win-0.1.271.iso')).toBeInTheDocument())
    expect(contentCalls).toBe(1)
    expect(screen.getByText('ISO Images (2)')).toBeInTheDocument()

    const names = screen.getAllByText(/\.iso$/).map(el => el.textContent)

    expect(names).toEqual(['virtio-win-0.1.271.iso', 'ubuntu-24.04.3-live-server-amd64.iso'])
  })

  it('deletes the volume, then reloads the content and notifies the parent', async () => {
    let deleted = ''

    server.use(
      http.delete(`${BASE}/content/:volid`, ({ params }) => {
        deleted = String(params.volid)
        items = items.filter(i => i.volid !== deleted)

        return HttpResponse.json({ data: null })
      }),
    )
    const onDelete = renderBrowser()

    await waitFor(() => expect(screen.getByText('virtio-win-0.1.271.iso')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTitle('Delete')[0])

    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    expect(deleted).toBe('local:iso/virtio-win-0.1.271.iso')
    await waitFor(() => expect(screen.queryByText('virtio-win-0.1.271.iso')).toBeNull())
    expect(contentCalls).toBe(2)
    expect(screen.getByText('ISO Images (1)')).toBeInTheDocument()
  })

  it('submits a picked file through the chunked upload client', async () => {
    h.uploadFileToStorage.mockReturnValue(new Promise(() => {}))
    renderBrowser()

    await waitFor(() => expect(screen.getByText('virtio-win-0.1.271.iso')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Upload'))

    const dialog = await screen.findByRole('dialog')
    const file = new File(['iso-bytes'], 'alpine-virt-3.22.1-x86_64.iso', { type: 'application/octet-stream' })

    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [file] } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(h.uploadFileToStorage).toHaveBeenCalledTimes(1))
    expect(h.uploadFileToStorage.mock.calls[0][0]).toMatchObject({
      connId: CONN,
      node: NODE,
      storage: STORAGE,
      file,
      contentType: 'iso',
    })
    expect(h.tasks.addTask).toHaveBeenCalledWith(expect.objectContaining({
      type: 'upload',
      label: 'Upload alpine-virt-3.22.1-x86_64.iso',
      cancelUrl: `/api/v1/connections/${CONN}/nodes/${NODE}/storage/${STORAGE}/upload`,
    }))
  })

  it('downloads from a URL with the file name taken from its path, then reloads the content', async () => {
    let body: Record<string, unknown> | null = null

    server.use(
      http.post(`${BASE}/download-url`, async ({ request }) => {
        body = await request.json() as Record<string, unknown>

        return HttpResponse.json({ data: 'UPID:pve1:0001:download' })
      }),
    )
    const onDelete = renderBrowser()

    await waitFor(() => expect(screen.getByText('virtio-win-0.1.271.iso')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('Upload'))

    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: /Download from URL/ }))
    fireEvent.change(within(dialog).getByLabelText('URL'), { target: { value: ISO_URL } })

    await waitFor(() => expect(within(dialog).getByLabelText('Filename')).toHaveValue('debian-13.1.0-amd64-netinst.iso'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ url: ISO_URL, content: 'iso', filename: 'debian-13.1.0-amd64-netinst.iso' })

    // The dialog closes and the list is refreshed 1.5 s after the task is accepted.
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(contentCalls).toBe(2)
  })
})
