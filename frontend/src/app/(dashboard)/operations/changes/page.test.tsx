/**
 * Change journal writes: a purge or a retention change the server refused
 * keeps its dialog open and says why, instead of closing as if it was done.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import { renderWithProviders, screen, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

const state = vi.hoisted(() => ({ toastError: vi.fn(), mutate: vi.fn(), mutateSettings: vi.fn() }))

vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: vi.fn() }) }))
vi.mock('@/contexts/LicenseContext', () => ({
  Features: { CHANGE_TRACKING: 'change_tracking' },
  useLicense: () => ({ hasFeature: () => true, loading: false }),
}))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: state.toastError, success: vi.fn(), showToast: vi.fn() }) }))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/hooks/useChanges', () => ({
  useChanges: () => ({ data: { data: [{ id: 'ch1', action: 'update', resourceType: 'vm', resourceId: '100', createdAt: '2026-10-31T08:00:00Z' }] }, isLoading: false, error: undefined, mutate: state.mutate }),
}))
vi.mock('@/hooks/useGuestStatus', () => ({ useGuestStatus: () => ({}) }))
vi.mock('@/hooks/useSWRFetch', () => ({ useSWRFetch: () => ({ data: { retentionDays: 30 }, mutate: state.mutateSettings }) }))
vi.mock('@/components/changes/ChangeJournal', () => ({
  default: ({ changes, toolbar }: { changes: unknown[]; toolbar: (rows: unknown[]) => ReactNode }) => <div>{toolbar(changes)}</div>,
}))

import ChangesPage from './page'

let status = 200
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  status = 200
  fetchMock = vi.fn(async () => new Response(JSON.stringify(status < 400 ? { success: true } : { error: 'journal locked' }), { status }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openPurge() {
  renderWithProviders(<ChangesPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Purge all changes' }))

  return within(screen.getByRole('dialog'))
}

async function openSettings() {
  renderWithProviders(<ChangesPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))

  return within(screen.getByRole('dialog'))
}

describe('change journal writes', () => {
  it('closes the purge dialog once the server purged', async () => {
    const dialog = await openPurge()
    await userEvent.click(dialog.getByRole('button', { name: 'Purge all' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/changes', { method: 'DELETE' })
    expect(state.toastError).not.toHaveBeenCalled()
  })

  it('keeps the purge dialog open with the reason when the server refused', async () => {
    status = 500
    const dialog = await openPurge()
    await userEvent.click(dialog.getByRole('button', { name: 'Purge all' }))

    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Error: journal locked'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it('keeps the retention dialog open with the reason when the server refused', async () => {
    status = 403
    const dialog = await openSettings()
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith('Error: journal locked'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(state.mutateSettings).not.toHaveBeenCalled()
  })

  it('saves the retention and closes', async () => {
    const dialog = await openSettings()
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/changes/settings', expect.objectContaining({ method: 'PUT', body: '{"retentionDays":30}' }))
  })
})
