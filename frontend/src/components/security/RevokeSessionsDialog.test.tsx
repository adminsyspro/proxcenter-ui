import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RevokeSessionsDialog from './RevokeSessionsDialog'

const { redirectToLoginOnceMock } = vi.hoisted(() => ({ redirectToLoginOnceMock: vi.fn() }))

// Partial module mock: the dialog must call the SHARED redirect helper (the
// same one useSWRFetch's fetcher uses on a 401), not roll its own navigation.
vi.mock('@/hooks/useSWRFetch', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useSWRFetch')>()),
  redirectToLoginOnce: redirectToLoginOnceMock,
}))

// Translate stub: return the key unchanged. The dialog receives `t` as a prop
// (not the next-intl hook), matching how the admin users page passes it down
// — see RoleDefaultScopeEditor.test.tsx for the same convention.
const t = (k: string) => k

const targetUser = { id: 'u1', email: 'target@example.com' }
const SESSIONS_URL = '*/api/v1/admin/users/u1/sessions'

describe('RevokeSessionsDialog', () => {
  afterEach(() => {
    cleanup()
    redirectToLoginOnceMock.mockClear()
  })

  it('issues DELETE /api/v1/admin/users/<id>/sessions and calls onSuccess(user.id) then onClose()', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    let deleteCalls = 0

    server.use(
      http.delete(SESSIONS_URL, () => {
        deleteCalls += 1
        return HttpResponse.json({ data: { revoked: 2 } })
      }),
    )

    renderWithProviders(
      <RevokeSessionsDialog open user={targetUser} onClose={onClose} onSuccess={onSuccess} t={t} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(deleteCalls).toBe(1))
    expect(onSuccess).toHaveBeenCalledWith('u1')
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
      <RevokeSessionsDialog open user={targetUser} onClose={onClose} onSuccess={onSuccess} t={t} />,
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
      <RevokeSessionsDialog open user={targetUser} onClose={vi.fn()} onSuccess={vi.fn()} t={t} />,
    )

    const confirmBtn = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirmBtn).not.toBeDisabled()

    await user.click(confirmBtn)

    await waitFor(() => expect(confirmBtn).toBeDisabled())

    // Let the in-flight request resolve so it doesn't leak into the next test.
    resolveDelete?.()
  })

  it('revoking all sessions of the caller themselves navigates to /login instead of updating the list', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    server.use(
      http.delete(SESSIONS_URL, () => HttpResponse.json({ data: { revoked: 3 } })),
    )

    renderWithProviders(
      <RevokeSessionsDialog
        open
        user={targetUser}
        currentUserId='u1'
        onClose={onClose}
        onSuccess={onSuccess}
        t={t}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(redirectToLoginOnceMock).toHaveBeenCalledTimes(1))
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("revoking another user's sessions does not navigate even with a currentUserId present", async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    server.use(
      http.delete(SESSIONS_URL, () => HttpResponse.json({ data: { revoked: 2 } })),
    )

    renderWithProviders(
      <RevokeSessionsDialog
        open
        user={targetUser}
        currentUserId='someone-else'
        onClose={onClose}
        onSuccess={onSuccess}
        t={t}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('u1'))
    expect(redirectToLoginOnceMock).not.toHaveBeenCalled()
  })

  it('warns when the target user is the caller themselves', () => {
    renderWithProviders(
      <RevokeSessionsDialog open user={targetUser} currentUserId='u1' onClose={vi.fn()} onSuccess={vi.fn()} t={t} />,
    )

    expect(screen.getByText('sessions.adminRevokeAllOwnConfirmWarning')).toBeInTheDocument()
  })

  it('does not warn when the target is another user', () => {
    renderWithProviders(
      <RevokeSessionsDialog open user={targetUser} currentUserId='someone-else' onClose={vi.fn()} onSuccess={vi.fn()} t={t} />,
    )

    expect(screen.queryByText('sessions.adminRevokeAllOwnConfirmWarning')).not.toBeInTheDocument()
  })
})
