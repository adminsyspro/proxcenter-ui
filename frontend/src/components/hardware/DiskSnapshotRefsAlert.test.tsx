/**
 * #1004: the warning shown when snapshots still hold a disk, with the same
 * remediation as the cross-cluster migration dialog: a button that never
 * deletes directly, but opens a confirmation naming every snapshot.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import { DiskSnapshotRefsAlert } from './DiskSnapshotRefsAlert'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ data: { success: true } }) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function props(overrides: Record<string, unknown> = {}) {
  return {
    snapshots: ['before-upgrade', 'clean'],
    mode: 'move' as const,
    vmKey: 'conn-1:qemu:pve3:100',
    canDeleteSnapshots: true,
    onDeleted: vi.fn(),
    ...overrides,
  }
}

const deleteButton = () => screen.getByRole('button', { name: /delete these snapshots/i })

describe('DiskSnapshotRefsAlert', () => {
  it('explains the move case and names the snapshots', () => {
    renderWithProviders(<DiskSnapshotRefsAlert {...props()} />)

    expect(screen.getByText(/still used by the snapshots: before-upgrade, clean.*kept as an unused disk/i)).toBeTruthy()
  })

  it('explains the delete case', () => {
    renderWithProviders(<DiskSnapshotRefsAlert {...props({ mode: 'delete' })} />)

    expect(screen.getByText(/cannot delete it while they exist/i)).toBeTruthy()
  })

  it('offers no delete button without the snapshot permission', () => {
    renderWithProviders(<DiskSnapshotRefsAlert {...props({ canDeleteSnapshots: false })} />)

    expect(screen.queryByRole('button', { name: /delete these snapshots/i })).toBeNull()
  })

  it('never deletes on the first click: it asks first, naming every snapshot', async () => {
    renderWithProviders(<DiskSnapshotRefsAlert {...props()} />)

    await userEvent.click(deleteButton())

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('before-upgrade')).toBeTruthy()
    expect(within(dialog).getByText('clean')).toBeTruthy()
    // Same snapshot icon as the Snapshots tab rows.
    for (const item of within(dialog).getAllByRole('listitem')) {
      expect(item.querySelector('i.ri-camera-fill')).not.toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the snapshots one by one once confirmed, then asks for a recheck', async () => {
    const p = props()
    renderWithProviders(<DiskSnapshotRefsAlert {...p} />)

    await userEvent.click(deleteButton())
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(p.onDeleted).toHaveBeenCalled())
    expect(fetchMock.mock.calls.map(c => [c[0], c[1]?.method])).toEqual([
      ['/api/v1/guests/conn-1%3Aqemu%3Apve3%3A100/snapshots?name=before-upgrade&wait=1', 'DELETE'],
      ['/api/v1/guests/conn-1%3Aqemu%3Apve3%3A100/snapshots?name=clean&wait=1', 'DELETE'],
    ])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stops at the first failure, shows it, and still rechecks what is left', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'snapshot is locked' }) })
    const p = props()
    renderWithProviders(<DiskSnapshotRefsAlert {...p} />)

    await userEvent.click(deleteButton())
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(/snapshot is locked/)).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(p.onDeleted).toHaveBeenCalled()
  })
})
