/**
 * IsoUploadControls (#894): the tenant-side "bring your own ISO" control of
 * the CD/DVD dialogs. Hidden unless the storage row says uploads are allowed;
 * the delete button only shows on the tenant's own `custom-*` files; a
 * refusal from the upload client surfaces as an alert.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }))
vi.mock('@/lib/storage/uploadClient', () => ({ uploadFileToStorage: (...a: any[]) => uploadMock(...a) }))

import { IsoUploadControls } from '@/components/hardware/IsoUploadControls'

const base = {
  connId: 'c1',
  node: 'pve1',
  storage: 'local',
  onUploaded: vi.fn(),
  onDeleted: vi.fn(),
  onBusy: vi.fn(),
}

beforeEach(() => {
  uploadMock.mockReset()
  base.onUploaded = vi.fn()
  base.onDeleted = vi.fn()
  base.onBusy = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('IsoUploadControls', () => {
  it('renders nothing when the storage does not accept tenant uploads', () => {
    renderWithProviders(
      <IsoUploadControls {...base} storageRow={{ storage: 'local', tenantCanUpload: false }} selectedIso="" />,
    )
    expect(screen.queryByTestId('iso-upload-controls')).toBeNull()
  })

  it('shows the upload button on an upload-enabled storage, and the delete button only for own custom-* files', () => {
    const { rerender } = renderWithProviders(
      <IsoUploadControls {...base} storageRow={{ storage: 'local', tenantCanUpload: true }} selectedIso="debian.iso" />,
    )
    expect(screen.getByText('Upload ISO')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete this ISO' })).toBeNull()

    rerender(
      <IsoUploadControls {...base} storageRow={{ storage: 'local', tenantCanUpload: true }} selectedIso="custom-acme-rescue.iso" />,
    )
    expect(screen.getByRole('button', { name: 'Delete this ISO' })).toBeTruthy()
  })

  it('uploads the picked file as iso content and hands the STORED name back', async () => {
    uploadMock.mockResolvedValue({ uploadId: 'u1', filename: 'custom-acme-rescue.iso' })
    renderWithProviders(
      <IsoUploadControls {...base} storageRow={{ storage: 'local', tenantCanUpload: true }} selectedIso="" />,
    )
    const input = screen.getByTestId('iso-upload-input') as HTMLInputElement
    const file = new File([new Uint8Array(16)], 'rescue.iso', { type: 'application/x-iso9660-image' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(base.onUploaded).toHaveBeenCalledWith('custom-acme-rescue.iso'))
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ connId: 'c1', node: 'pve1', storage: 'local', file, contentType: 'iso' }))
    expect(base.onBusy).toHaveBeenCalledWith(true)
    expect(base.onBusy).toHaveBeenLastCalledWith(false)
  })

  it('surfaces the server refusal verbatim', async () => {
    uploadMock.mockRejectedValue(new Error('This storage is a read-only ISO library'))
    renderWithProviders(
      <IsoUploadControls {...base} storageRow={{ storage: 'local', tenantCanUpload: true }} selectedIso="" />,
    )
    const input = screen.getByTestId('iso-upload-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], 'x.iso')] } })

    expect(await screen.findByText('This storage is a read-only ISO library')).toBeTruthy()
    expect(base.onUploaded).not.toHaveBeenCalled()
  })

  it('deletes the selected own ISO after confirmation and reports it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(
      <IsoUploadControls {...base} storageRow={{ storage: 'local', tenantCanUpload: true }} selectedIso="custom-acme-rescue.iso" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete this ISO' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(base.onDeleted).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain(`/storage/local/content/${encodeURIComponent('local:iso/custom-acme-rescue.iso')}`)
    expect(init).toMatchObject({ method: 'DELETE' })
  })
})
