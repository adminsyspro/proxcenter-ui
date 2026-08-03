import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import CreateTokenDialog, { filterToVisibleConnectionIds } from './CreateTokenDialog'

// A scope with no entry in the dialog's local icon map, standing in for a
// future addition to SCOPE_DEFINITIONS that nobody has wired an icon for yet.
vi.mock('@/lib/api-tokens/scopes', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-tokens/scopes')>()
  return { ...actual, ALL_SCOPE_IDS: [...actual.ALL_SCOPE_IDS, 'future:scope'] }
})

// Fix round 3, finding 1: no UI sequence has been shown to submit a stale
// connection id (the tenant-change effect clears the selection before the
// next user event can fire Create), so this exercises the structural
// backstop directly by constructing the "stale" state as function inputs,
// rather than by trying to force a race that does not exist through the UI.
describe('filterToVisibleConnectionIds', () => {
  const visibleForTenantA = [{ id: 'conn-a', tenantId: 'tenant-a', name: 'Tenant A PVE' }]

  it('drops an id that is not among the currently visible connections', () => {
    // 'conn-b' stands in for an id carried over from a different tenant's
    // selection that should never reach the request body.
    expect(filterToVisibleConnectionIds(['conn-a', 'conn-b'], visibleForTenantA)).toEqual(['conn-a'])
  })

  it('keeps every id when all are currently visible', () => {
    const visible = [
      { id: 'conn-a', tenantId: 'tenant-a', name: 'A' },
      { id: 'conn-b', tenantId: 'tenant-a', name: 'B' },
    ]
    expect(filterToVisibleConnectionIds(['conn-a', 'conn-b'], visible)).toEqual(['conn-a', 'conn-b'])
  })

  it('returns an empty array when nothing is visible', () => {
    expect(filterToVisibleConnectionIds(['conn-a'], [])).toEqual([])
  })

  it('returns an empty array when nothing was selected', () => {
    expect(filterToVisibleConnectionIds([], visibleForTenantA)).toEqual([])
  })
})

describe('CreateTokenDialog scopes layout', () => {
  beforeEach(() => {
    // The tenant/connection plumbing degrades gracefully on a failed fetch
    // (asserted elsewhere in ApiTokensTab.test.tsx); irrelevant to this
    // scopes-rendering test beyond needing `fetch` to exist under jsdom.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('falls back to a generic icon for a scope with no mapped entry', async () => {
    renderWithProviders(<CreateTokenDialog open onClose={() => {}} onCreated={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    const checkbox = within(dialog).getByLabelText('future:scope')
    const row = checkbox.closest('label') as HTMLElement
    expect(row.querySelector('i.ri-key-line')).not.toBeNull()
  })
})
