/**
 * writableStoragesFor / readOnlyLibraryError (#894): the writable set is
 * what every tenant write-target check must consult, with a fallback to the
 * visible set for scopes built before the writable map existed.
 */
import { describe, expect, it } from 'vitest'

import { readOnlyLibraryError, writableStoragesFor, type VdcScope } from './scope'

const CONN = 'conn-1'

function scopeWith(over: Partial<VdcScope>): VdcScope {
  return {
    connectionIds: new Set([CONN]),
    pbsConnectionIds: new Set(),
    nodesByConnection: new Map(),
    storagesByConnection: new Map([[CONN, new Set(['ceph', 'isolib'])]]),
    writableStoragesByConnection: new Map([[CONN, new Set(['ceph'])]]),
    isoLibrariesByConnection: new Map([[CONN, new Set(['isolib'])]]),
    uploadLibrariesByConnection: new Map([[CONN, new Set<string>()]]),
    storagePoliciesByConnection: new Map(),
    poolsByConnection: new Map(),
    vnetsByConnection: new Map(),
    sharedBridgesByConnection: new Map(),
    pbsNamespacesByConnection: new Map(),
    pbsNamespacesByPveConnection: new Map(),
    ...over,
  }
}

describe('writableStoragesFor', () => {
  it('returns the writable set, which excludes an ISO library the tenant can still see', () => {
    const w = writableStoragesFor(scopeWith({}), CONN)
    expect(w.has('ceph')).toBe(true)
    expect(w.has('isolib')).toBe(false)
  })

  it('falls back to the visible set when the scope predates the writable map', () => {
    const legacy = scopeWith({ writableStoragesByConnection: undefined as unknown as Map<string, Set<string>> })
    const w = writableStoragesFor(legacy, CONN)
    expect([...w].sort()).toEqual(['ceph', 'isolib'])
  })

  it('is empty for a connection the scope does not know', () => {
    expect(writableStoragesFor(scopeWith({}), 'elsewhere').size).toBe(0)
  })
})

describe('readOnlyLibraryError', () => {
  it('names the storage', () => {
    expect(readOnlyLibraryError('isolib')).toBe('Storage "isolib" is a read-only ISO library')
  })
})
