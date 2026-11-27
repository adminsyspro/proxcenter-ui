/**
 * TDD tests for events.ts:
 *   - Unit: filter by involvedObject uid/name, RFC3339 timestamps, sort, caps.
 */
import { describe, it, expect } from 'vitest'
import { listEvents, projectEvent, type RawK8sEvent } from './events'

// ── helpers ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<RawK8sEvent> = {}): RawK8sEvent {
  return {
    type: 'Normal',
    reason: 'Test',
    message: 'msg',
    count: 1,
    firstTimestamp: new Date('2024-06-01T10:00:00Z'),
    lastTimestamp: new Date('2024-06-01T10:01:00Z'),
    involvedObject: { kind: 'Pod', name: 'mypod', uid: 'uid-1' },
    ...overrides,
  }
}

// ── projectEvent unit tests ────────────────────────────────────────────────

describe('projectEvent', () => {
  it('formats object as Kind/Name', () => {
    const e = makeEvent({ involvedObject: { kind: 'Deployment', name: 'web', uid: 'u1' } })
    const out = projectEvent(e)
    expect(out.object).toBe('Deployment/web')
  })

  it('formats RFC3339 timestamps (no sub-second)', () => {
    const e = makeEvent({
      firstTimestamp: new Date('2024-06-01T12:00:00.000Z'),
      lastTimestamp: new Date('2024-06-01T12:05:30.999Z'),
    })
    const out = projectEvent(e)
    expect(out.firstSeen).toBe('2024-06-01T12:00:00Z')
    expect(out.lastSeen).toBe('2024-06-01T12:05:30Z')
  })

  it('returns empty string for zero/undefined timestamps', () => {
    const e = makeEvent({ firstTimestamp: undefined, lastTimestamp: undefined })
    const out = projectEvent(e)
    expect(out.firstSeen).toBe('')
    expect(out.lastSeen).toBe('')
  })

  it('truncates message to 2000 chars', () => {
    const longMsg = 'x'.repeat(3000)
    const e = makeEvent({ message: longMsg })
    const out = projectEvent(e)
    expect(out.message.length).toBe(2000)
  })

  it('passes through type, reason, count', () => {
    const e = makeEvent({ type: 'Warning', reason: 'BackOff', count: 7 })
    const out = projectEvent(e)
    expect(out.type).toBe('Warning')
    expect(out.reason).toBe('BackOff')
    expect(out.count).toBe(7)
  })
})

// ── filter + sort + cap unit tests (via mock list fn) ─────────────────────

describe('listEvents filtering and sorting', () => {
  it('filters by involvedUid using fieldSelector', async () => {
    // Simulate the client returning only matched events (field selector applied server-side).
    // We test that the option is passed and the result is projected correctly.
    let capturedSelector: string | undefined
    const mockFetch = async (selector?: string) => {
      capturedSelector = selector
      return [
        makeEvent({ involvedObject: { kind: 'Pod', name: 'p1', uid: 'uid-abc' } }),
      ]
    }
    const result = await listEvents(
      { clusterId: 'c1', credentialVersion: 1, server: 'https://unused', cred: { type: 'token', value: 't' } } as any,
      { involvedUid: 'uid-abc' },
      mockFetch,
    )
    expect(result.ok).toBe(true)
    expect(capturedSelector).toBe('involvedObject.uid=uid-abc')
    expect(result.value?.items).toHaveLength(1)
    expect(result.value?.items[0].object).toBe('Pod/p1')
  })

  it('filters by involvedName when uid not set', async () => {
    let capturedSelector: string | undefined
    const mockFetch = async (selector?: string) => {
      capturedSelector = selector
      return [makeEvent({ involvedObject: { kind: 'Pod', name: 'mypod', uid: 'uid-x' } })]
    }
    await listEvents(
      { clusterId: 'c1', credentialVersion: 1, server: 'https://unused', cred: { type: 'token', value: 't' } } as any,
      { involvedName: 'mypod' },
      mockFetch,
    )
    expect(capturedSelector).toBe('involvedObject.name=mypod')
  })

  it('uid takes precedence over name', async () => {
    let capturedSelector: string | undefined
    const mockFetch = async (selector?: string) => {
      capturedSelector = selector
      return []
    }
    await listEvents(
      { clusterId: 'c1', credentialVersion: 1, server: 'https://unused', cred: { type: 'token', value: 't' } } as any,
      { involvedUid: 'uid-1', involvedName: 'also-set' },
      mockFetch,
    )
    expect(capturedSelector).toBe('involvedObject.uid=uid-1')
  })

  it('returns empty items array for empty result', async () => {
    const result = await listEvents(
      { clusterId: 'c1', credentialVersion: 1, server: 'https://unused', cred: { type: 'token', value: 't' } } as any,
      {},
      async () => [],
    )
    expect(result.ok).toBe(true)
    expect(result.value?.items).toHaveLength(0)
  })

  it('sorts descending by lastTimestamp (most recent first)', async () => {
    const events: RawK8sEvent[] = [
      makeEvent({ lastTimestamp: new Date('2024-06-01T10:00:00Z'), involvedObject: { kind: 'Pod', name: 'old', uid: 'u1' } }),
      makeEvent({ lastTimestamp: new Date('2024-06-01T12:00:00Z'), involvedObject: { kind: 'Pod', name: 'new', uid: 'u2' } }),
      makeEvent({ lastTimestamp: new Date('2024-06-01T11:00:00Z'), involvedObject: { kind: 'Pod', name: 'mid', uid: 'u3' } }),
    ]
    const result = await listEvents(
      { clusterId: 'c1', credentialVersion: 1, server: 'https://unused', cred: { type: 'token', value: 't' } } as any,
      {},
      async () => events,
    )
    expect(result.ok).toBe(true)
    const items = result.value!.items
    expect(items[0].object).toBe('Pod/new')
    expect(items[1].object).toBe('Pod/mid')
    expect(items[2].object).toBe('Pod/old')
  })

  it('caps at 200 items, keeping most recent', async () => {
    const now = new Date('2024-06-01T00:00:00Z').getTime()
    const events: RawK8sEvent[] = Array.from({ length: 210 }, (_, i) => ({
      type: 'Normal',
      reason: 'Test',
      message: `msg-${i}`,
      count: 1,
      firstTimestamp: new Date(now + i * 60000),
      lastTimestamp: new Date(now + i * 60000),
      involvedObject: { kind: 'Pod', name: `p${i}`, uid: `u${i}` },
    }))
    const result = await listEvents(
      { clusterId: 'c1', credentialVersion: 1, server: 'https://unused', cred: { type: 'token', value: 't' } } as any,
      {},
      async () => events,
    )
    expect(result.value?.items).toHaveLength(200)
    // After sort desc + cap, first item should be the most recent (i=209)
    expect(result.value?.items[0].object).toBe('Pod/p209')
  })
})
