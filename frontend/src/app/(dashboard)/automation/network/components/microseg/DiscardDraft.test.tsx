/**
 * R66: the pending micro-segmentation changes can be discarded from the pending bar (Policy tab and Firewalling) and
 * from the refusal of a zone state change: a themed confirmation stating the count, POST /policy/discard with the
 * draft version, the policy replaced by the answer; a draft changed meanwhile is read again and the dialog says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegPolicy } from '@/lib/microseg/types'

vi.mock('@/lib/microseg/useLastRevision', () => ({ useLastRevisionSnapshot: () => ({ revision: null, loading: false }) }))

import { MicrosegWriteContext } from './microsegAccess'
import PendingChangesBar from './PendingChangesBar'

afterEach(cleanup)

// No revision yet: every zone of the draft counts as a pending change.
const POLICY = {
  policy: { id: 'p1', tag_prefix: 'pc-', settings: {} },
  version: 7,
  zones: [{ id: 'z1', name: 'db' }, { id: 'z2', name: 'app' }],
  flows: [],
  pending_members: [],
  pending_changes: true,
  last_revision: null,
} as unknown as MicrosegPolicy

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch') })
afterEach(() => fetchSpy.mockRestore())

const renderBar = (canWrite = true) => renderWithProviders(
  <MicrosegWriteContext.Provider value={canWrite}><PendingChangesBar connectionId='c1' policy={POLICY} onOpenPlan={vi.fn()} /></MicrosegWriteContext.Provider>,
)

const discardCalls = () => fetchSpy.mock.calls.filter(([url, init]) => String(url).endsWith('/policy/discard') && (init as RequestInit)?.method === 'POST')

describe('Discard of the pending micro-segmentation changes', () => {
  it('confirms with the count, then posts the draft version', async () => {
    fetchSpy.mockImplementation(async (url: unknown) => (String(url).endsWith('/policy/discard') ? json(200, { ...POLICY, zones: [], pending_changes: false }) : json(200, {})))
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Discard the 2 unapplied changes?')
    expect(dialog).toHaveTextContent('The draft goes back to the last applied revision.')
    expect(discardCalls()).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(discardCalls()).toHaveLength(1))
    expect(JSON.parse(String((discardCalls()[0][1] as RequestInit).body))).toEqual({ version: 7 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('on a draft changed meanwhile: says it was read again, keeps the dialog open', async () => {
    fetchSpy.mockImplementation(async (url: unknown) => (String(url).endsWith('/policy/discard')
      ? json(409, { code: 'VERSION_CONFLICT', error: 'version mismatch' })
      : json(200, POLICY)))
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('The policy changed elsewhere and was reloaded. Check it, then try again.')).toBeInTheDocument()
    // The draft is read again through its SWR key (mounted by the tab around the bar), no second discard is sent.
    expect(discardCalls()).toHaveLength(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a read-only user sees Discard disabled, with the reason', async () => {
    renderBar(false)
    const button = screen.getByRole('button', { name: 'Discard changes' })
    expect(button).toBeDisabled()
    fireEvent.mouseOver(button.parentElement!)
    expect(await screen.findByText('Read-only: you need node management rights')).toBeInTheDocument()
  })
})
