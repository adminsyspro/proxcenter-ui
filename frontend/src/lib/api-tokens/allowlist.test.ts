import { describe, expect, it } from 'vitest'

import {
  PUBLIC_API_ALLOWLIST,
  getAllowlistEntryById,
  isRejectedPath,
  matchPublicApiPath,
  matchesEntry,
  matchEntryParams,
} from './allowlist'

describe('PUBLIC_API_ALLOWLIST data', () => {
  it('contains exactly the 7 phase-1 entries with the spec scopes', () => {
    const byId = Object.fromEntries(PUBLIC_API_ALLOWLIST.map(e => [e.id, e]))
    expect(Object.keys(byId).sort()).toEqual([
      'inventory-tree', 'pbs-backups', 'public-backups', 'public-health',
      'public-metrics', 'storage-list', 'vms-list',
    ])
    expect(byId['vms-list'].pattern).toBe('/api/v1/vms')
    expect(byId['vms-list'].requiredScopes).toEqual(['vms:read'])
    expect(byId['inventory-tree'].requiredScopes).toEqual(['nodes:read'])
    expect(byId['storage-list'].requiredScopes).toEqual(['storage:read'])
    expect(byId['pbs-backups'].pattern).toBe('/api/v1/pbs/{id}/backups')
    expect(byId['pbs-backups'].requiredScopes).toEqual(['backups:read'])
    expect(byId['pbs-backups'].connectionSegment).toBe('id')
    expect(byId['public-backups'].requiredScopes).toEqual(['backups:read'])
    expect(byId['public-metrics'].requiredScopes).toEqual(['nodes:read', 'vms:read', 'backups:read'])
    expect(byId['public-health'].requiredScopes).toEqual([])
    for (const entry of PUBLIC_API_ALLOWLIST) {
      expect(entry.method).toBe('GET')
      expect(entry.routeFile).toMatch(/^src\/app\/api\/v1\/.+\/route\.ts$/)
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(entry.responseSchemaRef.length).toBeGreaterThan(0)
    }
  })
})

describe('shared canonical matcher', () => {
  it('matches literal patterns segment per segment, case sensitive', () => {
    expect(matchPublicApiPath('/api/v1/vms')).toEqual({ ok: true, entryId: 'vms-list', params: {} })
    expect(matchPublicApiPath('/api/v1/VMS').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1/vms/extra').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1').ok).toBe(false)
  })

  it('binds a named dynamic segment', () => {
    const m = matchPublicApiPath('/api/v1/pbs/conn-42/backups')
    expect(m.ok).toBe(true)
    expect(m.entryId).toBe('pbs-backups')
    expect(m.params).toEqual({ id: 'conn-42' })
  })

  it('never matches by prefix', () => {
    expect(matchPublicApiPath('/api/v1/vms-list').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1/pbs/conn-42/backups/tail').ok).toBe(false)
  })

  it('rejects dangerous paths BEFORE any matching', () => {
    expect(isRejectedPath('/api/v1/pbs/a%2Fb/backups')).toBe(true)
    expect(isRejectedPath('/api/v1/pbs/a%2fb/backups')).toBe(true)
    expect(isRejectedPath('/api/v1/pbs/a%5Cb/backups')).toBe(true)
    expect(isRejectedPath('/api//v1/vms')).toBe(true)
    expect(isRejectedPath('/api/v1/./vms')).toBe(true)
    expect(isRejectedPath('/api/v1/../vms')).toBe(true)
    expect(isRejectedPath('/api/v1/vms/')).toBe(true)
    expect(isRejectedPath('/api/v1/vms')).toBe(false)
    expect(matchPublicApiPath('/api/v1/vms/').ok).toBe(false)
  })

  it('matchesEntry re-verifies against ONE designated entry only', () => {
    const vms = getAllowlistEntryById('vms-list')!
    expect(matchesEntry(vms, '/api/v1/vms')).toBe(true)
    expect(matchesEntry(vms, '/api/v1/storage')).toBe(false)
    const pbs = getAllowlistEntryById('pbs-backups')!
    expect(matchEntryParams(pbs, '/api/v1/pbs/conn-7/backups')).toEqual({ id: 'conn-7' })
    expect(matchEntryParams(pbs, '/api/v1/pbs/conn-7/backups/')).toBeNull()
  })

  it('getAllowlistEntryById returns null on unknown ids', () => {
    expect(getAllowlistEntryById('nope')).toBeNull()
  })

  it('the edge match and the server-side re-check against the resolved entry never disagree, and no path matches two entries', () => {
    const samplePathById: Record<string, string> = {
      'vms-list': '/api/v1/vms',
      'inventory-tree': '/api/v1/inventory',
      'storage-list': '/api/v1/storage',
      'pbs-backups': '/api/v1/pbs/conn-1/backups',
      'public-backups': '/api/v1/public/backups',
      'public-metrics': '/api/v1/public/metrics',
      'public-health': '/api/v1/public/health',
    }
    for (const entry of PUBLIC_API_ALLOWLIST) {
      const path = samplePathById[entry.id]
      const edgeMatch = matchPublicApiPath(path)
      expect(edgeMatch.ok).toBe(true)
      expect(edgeMatch.entryId).toBe(entry.id)

      const resolvedEntry = getAllowlistEntryById(edgeMatch.entryId!)!
      expect(matchesEntry(resolvedEntry, path)).toBe(true)
      expect(matchEntryParams(resolvedEntry, path)).toEqual(edgeMatch.params)

      for (const other of PUBLIC_API_ALLOWLIST) {
        if (other.id === entry.id) continue
        expect(matchesEntry(other, path)).toBe(false)
      }
    }
  })
})
