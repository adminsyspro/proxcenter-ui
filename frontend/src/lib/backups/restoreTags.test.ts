import { describe, expect, it, vi } from 'vitest'

import { checkRestoredTagsOmitted, parseGuestTags, restoredTagsCheckMessage } from './restoreTags'

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

const noSleep = vi.fn(async () => {})

describe('parseGuestTags', () => {
  it('splits on every separator PVE accepts and drops blanks', () => {
    expect(parseGuestTags('prod;proxcenter-replica')).toEqual(['prod', 'proxcenter-replica'])
    expect(parseGuestTags('a, b c;;')).toEqual(['a', 'b', 'c'])
  })

  it('reads the blank line an empty override leaves as no tag at all', () => {
    expect(parseGuestTags(' ')).toEqual([])
    expect(parseGuestTags('')).toEqual([])
    expect(parseGuestTags(undefined)).toEqual([])
    expect(parseGuestTags(42)).toEqual([])
  })
})

describe('checkRestoredTagsOmitted', () => {
  it('reads the guest config route and reports a clean guest', async () => {
    const fetchImpl = vi.fn(async () => json({ data: { name: 'vm', tags: ' ' } }))

    const res = await checkRestoredTagsOmitted({ connectionId: 'c 1', node: 'pve1', type: 'lxc', vmid: 9967, fetchImpl, sleep: noSleep })

    expect(res).toEqual({ status: 'clean' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe('/api/v1/connections/c%201/guests/lxc/pve1/9967/config')
  })

  it('retries a guest that still shows tags, then reports them', async () => {
    const fetchImpl = vi.fn(async () => json({ data: { tags: 'prod;proxcenter-replica' } }))

    const res = await checkRestoredTagsOmitted({ connectionId: 'c', node: 'n', type: 'qemu', vmid: 1, attempts: 3, fetchImpl, sleep: noSleep })

    expect(res).toEqual({ status: 'kept', tags: ['prod', 'proxcenter-replica'] })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('settles as clean when a later read no longer shows tags', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ data: { tags: 'prod' } }))
      .mockResolvedValueOnce(json({ data: {} }))

    const res = await checkRestoredTagsOmitted({ connectionId: 'c', node: 'n', type: 'qemu', vmid: 1, fetchImpl, sleep: noSleep })

    expect(res).toEqual({ status: 'clean' })
  })

  it('reports an unreadable config as unknown, never as clean', async () => {
    const httpError = vi.fn(async () => json({ error: 'denied' }, 403))
    expect(await checkRestoredTagsOmitted({ connectionId: 'c', node: 'n', type: 'qemu', vmid: 1, attempts: 2, fetchImpl: httpError, sleep: noSleep }))
      .toEqual({ status: 'unknown', error: 'denied' })

    const thrown = vi.fn(async () => { throw new Error('offline') })
    expect(await checkRestoredTagsOmitted({ connectionId: 'c', node: 'n', type: 'qemu', vmid: 1, attempts: 1, fetchImpl: thrown, sleep: noSleep }))
      .toEqual({ status: 'unknown', error: 'offline' })

    const bareStatus = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') } }) as unknown as Response)
    expect(await checkRestoredTagsOmitted({ connectionId: 'c', node: 'n', type: 'qemu', vmid: 1, attempts: 0, fetchImpl: bareStatus, sleep: noSleep }))
      .toEqual({ status: 'unknown', error: 'HTTP 502' })
  })
})

describe('restoredTagsCheckMessage', () => {
  const t = (key: string, values?: Record<string, string | number>) => `${key}:${JSON.stringify(values ?? {})}`

  it('says nothing for a clean guest and names the tags or the error otherwise', () => {
    expect(restoredTagsCheckMessage({ status: 'clean' }, t)).toBeNull()
    expect(restoredTagsCheckMessage({ status: 'kept', tags: ['a', 'b'] }, t)).toBe('inventory.pbsRestoreTagsKept:{"tags":"a, b"}')
    expect(restoredTagsCheckMessage({ status: 'unknown', error: 'x' }, t)).toBe('inventory.pbsRestoreTagsUnverified:{"error":"x"}')
  })
})
