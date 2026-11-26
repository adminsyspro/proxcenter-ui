import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import RiskAcceptanceDialog from './RiskAcceptanceDialog'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const fetchMock = vi.fn()
const onClose = vi.fn()
const onDone = vi.fn()
const ok = (body: unknown = { success: true }) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const failing = { id: 'node_firewalls', name: 'Node firewalls enabled', status: 'fail' }
const accepted = { ...failing, status: 'accepted' }

const show = (check: typeof failing | null) =>
  render(<RiskAcceptanceDialog connectionId="conn 1" check={check} onClose={onClose} onDone={onDone} />)

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  onClose.mockClear()
  onDone.mockClear()
})

describe('RiskAcceptanceDialog', () => {
  it('renders nothing without a check', () => {
    show(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the confirm button off until the justification is long enough', async () => {
    show(failing)
    const confirm = screen.getByRole('button', { name: 'accept' })
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/justification/), 'too short')
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/justification/), ', now it is long enough')
    expect(confirm).toBeEnabled()
  })

  it('posts the justification and the expiry day, then reports and closes', async () => {
    fetchMock.mockResolvedValue(ok())
    show(failing)

    await userEvent.type(screen.getByLabelText(/justification/), 'Handled by the host firewall')
    fireEvent.change(screen.getByLabelText(/expiry/), { target: { value: '2027-02-23' } })
    await userEvent.click(screen.getByRole('button', { name: 'accept' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/compliance/hardening/conn%201/acceptances')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      check_id: 'node_firewalls', justification: 'Handled by the host firewall', expires_at: new Date(2027, 1, 23, 23, 59, 59).toISOString(),
    })
  })

  it('shows the refusal and stays open when the save fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Permission denied: admin.compliance' }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
    show(failing)

    await userEvent.type(screen.getByLabelText(/justification/), 'Handled by the host firewall')
    await userEvent.click(screen.getByRole('button', { name: 'accept' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied: admin.compliance')
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('revokes an accepted check with no form to fill', async () => {
    fetchMock.mockResolvedValue(ok())
    show(accepted)

    expect(screen.queryByLabelText(/justification/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'revoke' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/compliance/hardening/conn%201/acceptances?checkId=node_firewalls')
    expect(init.method).toBe('DELETE')
  })

  it('closes on cancel without calling the server', async () => {
    show(failing)
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
