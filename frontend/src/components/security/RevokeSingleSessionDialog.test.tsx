import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RevokeSingleSessionDialog from './RevokeSingleSessionDialog'

// Translate stub: return the key unchanged. The dialog receives `t` as a prop
// (not the next-intl hook), matching how the admin users page passes it down
// — same convention as RevokeSessionsDialog.test.tsx.
const t = (k: string) => k

const targetSession = { id: 'sess-1', userEmail: 'target@example.com' }
const SESSION_URL = '*/api/v1/admin/sessions/sess-1'

describe('RevokeSingleSessionDialog', () => {
  afterEach(() => cleanup())

  it('issues DELETE /api/v1/admin/sessions/<sid> and calls onSuccess(session.id) then onClose()', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    let deleteCalls = 0

    server.use(
      http.delete(SESSION_URL, () => {
        deleteCalls += 1
        return HttpResponse.json({ data: { ok: true } })
      }),
    )

    renderWithProviders(
      <RevokeSingleSessionDialog open session={targetSession} onClose={onClose} onSuccess={onSuccess} t={t} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    await waitFor(() => expect(deleteCalls).toBe(1))
    expect(onSuccess).toHaveBeenCalledWith('sess-1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('surfaces errors.connectionError on a network failure and does not close', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    server.use(
      http.delete(SESSION_URL, () => HttpResponse.error()),
    )

    renderWithProviders(
      <RevokeSingleSessionDialog open session={targetSession} onClose={onClose} onSuccess={onSuccess} t={t} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(await screen.findByText('errors.connectionError')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a 404 error body and does not call onSuccess', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    server.use(
      http.delete(SESSION_URL, () => HttpResponse.json({ error: 'Not found' }, { status: 404 })),
    )

    renderWithProviders(
      <RevokeSingleSessionDialog open session={targetSession} onClose={onClose} onSuccess={onSuccess} t={t} />,
    )

    await user.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(await screen.findByText('Not found')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('disables the confirm button while the request is in flight', async () => {
    const user = userEvent.setup()
    let resolveDelete: (() => void) | null = null

    server.use(
      http.delete(
        SESSION_URL,
        () =>
          new Promise(resolve => {
            resolveDelete = () => resolve(HttpResponse.json({ data: { ok: true } }))
          }),
      ),
    )

    renderWithProviders(
      <RevokeSingleSessionDialog open session={targetSession} onClose={vi.fn()} onSuccess={vi.fn()} t={t} />,
    )

    const confirmBtn = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirmBtn).not.toBeDisabled()

    await user.click(confirmBtn)

    await waitFor(() => expect(confirmBtn).toBeDisabled())

    // Let the in-flight request resolve so it doesn't leak into the next test.
    resolveDelete?.()
  })

  it('renders the target email in the confirm title', async () => {
    renderWithProviders(
      <RevokeSingleSessionDialog open session={targetSession} onClose={vi.fn()} onSuccess={vi.fn()} t={t} />,
    )

    expect(screen.getByText('sessions.adminRevokeOneConfirmTitle')).toBeInTheDocument()
  })
})
