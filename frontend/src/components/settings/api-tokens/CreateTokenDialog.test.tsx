import { describe, expect, it } from 'vitest'

import { filterToVisibleConnectionIds } from './CreateTokenDialog'

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
