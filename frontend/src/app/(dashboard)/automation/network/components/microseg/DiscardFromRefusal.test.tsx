/**
 * Recette nit: after Discard from the refusal of a zone state change (UA30), the enforce confirmation must become
 * usable at once (the draft is clean): Enforce enabled, the dialog still open. The policy is the real SWR hook of the
 * tabs (useMicrosegPolicy), so the discard's mutate is what the gate re-evaluates on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import type { MicrosegPolicy } from '@/lib/microseg/types'

vi.mock('@/lib/microseg/useLastRevision', () => ({ useLastRevisionSnapshot: () => ({ revision: null, loading: false }) }))

import { ZoneStateConfirm } from './ZonePanelActions'
import { useZoneEdits } from './useZoneEdits'

afterEach(cleanup)

// A zone observed for a week, nothing pending in its suggestions: ready, no name to type.
const ZONE = { id: 'zd', name: 'db', state: 'observe', observe_since: '2026-10-01T00:00:00Z', isolate_members: false }
const policy = (pending: boolean) => ({
  policy: { id: 'p1', tag_prefix: 'pc-', settings: { ready_after_hours: 24 } },
  version: pending ? 7 : 8,
  zones: [ZONE],
  flows: [],
  pending_members: [],
  pending_changes: pending,
  last_revision: { id: 'r1', version: 6 },
}) as unknown as MicrosegPolicy

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function Harness() {
  const { data, reload } = useMicrosegPolicy('c1')
  if (!data) return null
  return <Confirm policy={data} reload={reload} />
}

function Confirm({ policy: p, reload }: { policy: MicrosegPolicy; reload: () => Promise<unknown> }) {
  const edits = useZoneEdits({ connectionId: 'c1', policy: p, reloadPolicy: reload, startRun: vi.fn(), onOpenPlan: vi.fn() })
  return <ZoneStateConfirm zone={p.zones[0]} state='enforce' edits={edits} onClose={vi.fn()} />
}

let fetchSpy: ReturnType<typeof vi.spyOn>
let clean = false
beforeEach(() => {
  clean = false
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/policy/discard') && init?.method === 'POST') {
      clean = true
      // As seen on the lab: the answer may still carry the pending flag; GET /policy then reads it false. The gate
      // must follow GET /policy, not only the answer.
      return json({ ...policy(false), pending_changes: true })
    }
    if (path.endsWith('/policy')) return json(policy(!clean))
    if (path.includes('/suggestions')) return json({ suggestions: [], total: 0 })
    return json({})
  })
})
afterEach(() => fetchSpy.mockRestore())

describe('Discard from the refusal of an enforce', () => {
  it('leaves the enforce confirmation open and usable once the draft is clean', async () => {
    renderWithProviders(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}><Harness /></SWRConfig>)
    const dialog = await screen.findByRole('dialog', { name: 'Enforce zone db?' })
    await screen.findByText('Nothing would have been blocked in the last 24 hours.')
    expect(within(dialog).getByRole('button', { name: 'Enforce' })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    const confirm = await screen.findByRole('dialog', { name: /Discard the/ })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Enforce zone db?' })).getByRole('button', { name: 'Enforce' })).toBeEnabled())
    expect(within(screen.getByRole('dialog', { name: 'Enforce zone db?' })).queryByRole('button', { name: 'Discard changes' })).toBeNull()
  })
})
