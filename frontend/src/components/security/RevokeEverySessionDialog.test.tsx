import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RevokeEverySessionDialog from './RevokeEverySessionDialog'

// Translate stub: return the key unchanged — same convention as the two
// sibling revoke dialogs' tests.
const t = (k: string) => k

const SESSIONS_URL = '*/api/v1/admin/sessions'

describe('RevokeEverySessionDialog', () => {
  afterEach(() => cleanup())

  it('issues DELETE /api/v1/admin/sessions and calls onSuccess() then onClose()', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    let deleteCalls = 0

    server.use(
      http.delete(SESSIONS_URL, () => {
        deleteCalls += 1
        return HttpResponse.json({ data: { revoked: 7 } })
      }),
    )

    renderWithProviders(
      <RevokeEverySessionDialog open onClose={onClose} onSuccess={onSuccess} t={t} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(deleteCalls).toBe(1))
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('surfaces errors.connectionError on a network failure and does not close', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    server.use(
      http.delete(SESSIONS_URL, () => HttpResponse.error()),
    )

    renderWithProviders(
      <RevokeEverySessionDialog open onClose={onClose} onSuccess={onSuccess} t={t} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(await screen.findByText('errors.connectionError')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables the confirm button while the request is in flight', async () => {
    const user = userEvent.setup()
    let resolveDelete: (() => void) | null = null

    server.use(
      http.delete(
        SESSIONS_URL,
        () =>
          new Promise(resolve => {
            resolveDelete = () => resolve(HttpResponse.json({ data: { revoked: 1 } }))
          }),
      ),
    )

    renderWithProviders(
      <RevokeEverySessionDialog open onClose={vi.fn()} onSuccess={vi.fn()} t={t} />,
    )

    const confirmBtn = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirmBtn).not.toBeDisabled()

    await user.click(confirmBtn)

    await waitFor(() => expect(confirmBtn).toBeDisabled())

    // Let the in-flight request resolve so it doesn't leak into the next test.
    resolveDelete?.()
  })
})
