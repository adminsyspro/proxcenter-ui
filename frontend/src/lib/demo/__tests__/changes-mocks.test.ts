import { describe, it, expect } from 'vitest'

import { ACTIONS, backupSummary } from '@/lib/changes/journal'

import { demoResponse } from '../demo-api'
import { demoChangeJournal, queryChanges } from '../mocks/changes'

const demoGet = async (path: string): Promise<any> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`))

    return res ? await res.json() : null
  } finally {
    process.env.DEMO_MODE = prev
  }
}

describe('demo change journal', () => {
  const now = Date.parse('2026-10-29T15:00:00Z')
  const journal = demoChangeJournal(now)

  it('is heterogeneous: every journal action shows up', () => {
    const actions = new Set(journal.map(c => c.action))

    for (const action of Object.keys(ACTIONS)) expect(actions, action).toContain(action)
  })

  it('gives every row something to expand (ChangeJournal.hasDetails)', () => {
    // A row is clickable only with fields, or as a backup.
    for (const c of journal) expect(c.action === 'backup' || c.fields.length > 0, String(c.id)).toBe(true)
  })

  it('is newest first with unique numeric ids, inside 30 days and never in the future', () => {
    const times = journal.map(c => Date.parse(c.timestamp))

    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(new Set(journal.map(c => c.id)).size).toBe(journal.length)
    expect(journal.every(c => typeof c.id === 'number')).toBe(true)
    expect(Math.max(...times)).toBeLessThanOrEqual(now)
    expect(Math.min(...times)).toBeGreaterThan(now - 31 * 86_400_000)
  })

  it('stays the same between two polls of the same day', () => {
    expect(demoChangeJournal(now + 60_000).filter(c => Date.parse(c.timestamp) <= now)).toEqual(journal)
  })

  it('attributes every row, with the three levels the AuthorCell badge shows', () => {
    const levels = new Set(journal.map(c => c.attribution))

    expect([...levels].sort((a, b) => a.localeCompare(b))).toEqual(['inferred', 'unknown', 'verified'])
    for (const c of journal) {
      if (c.attribution === 'unknown') expect(c.user).toBe('')
      else expect(c.actors.some((a: any) => a.name === c.user), String(c.id)).toBe(true)
      // ProxCenter's token only shows it acting: never the named author.
      expect(c.user).not.toContain('!')
    }
  })

  it('backups carry a finished vzdump task the summary can read', () => {
    for (const c of journal.filter(x => x.action === 'backup')) {
      const b = backupSummary(c)

      expect(['ok', 'failed']).toContain(b.state)
      expect(b.durationSec).toBeGreaterThan(0)
      expect(c.taskUpid).toMatch(/:vzdump:/)
    }
  })

  it('a migration ends on the node the row names', () => {
    for (const c of journal.filter(x => x.action === 'migrated')) {
      expect(c.fields[0]).toMatchObject({ field: '_node', newValue: c.node })
      expect(c.fields[0].oldValue).not.toBe(c.node)
    }
  })

  it('filters and caps like the orchestrator', () => {
    const one = journal[0]
    const byGuest = queryChanges(new URL(`http://x/api/v1/changes?resourceId=${one.resourceId}&connectionId=${one.connectionId}`), now)

    expect(byGuest.data.length).toBeGreaterThan(0)
    expect(byGuest.data.every((c: any) => c.resourceId === one.resourceId)).toBe(true)
    expect(queryChanges(new URL('http://x/api/v1/changes?action=migrated'), now).data.every((c: any) => c.action === 'migrated')).toBe(true)
    // handler_changes.go: a limit above 500 falls back to 200.
    expect(queryChanges(new URL('http://x/api/v1/changes?limit=5000'), now).data.length).toBeLessThanOrEqual(200)
    expect(queryChanges(new URL('http://x/api/v1/changes?limit=3'), now).total).toBe(3)
    const from = new Date(now - 2 * 86_400_000).toISOString()

    expect(queryChanges(new URL(`http://x/api/v1/changes?from=${from}`), now).data.every((c: any) => c.timestamp >= from)).toBe(true)
  })

  it('is what /changes and /changes/recent answer in demo mode', async () => {
    const list = await demoGet('/api/v1/changes?limit=5000')
    const recent = await demoGet('/api/v1/changes/recent?limit=10')

    expect(list.total).toBe(list.data.length)
    expect(recent.data).toHaveLength(10)
    expect(recent.data[0].fields.length).toBeGreaterThan(0)
  })
})
