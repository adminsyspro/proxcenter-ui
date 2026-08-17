/**
 * Unit tests for hardware/utils.ts: fetchNextVmid and the VMID scoping helpers.
 *
 * Runs in the jsdom lane (MSW-backed fetch) because fetchNextVmid is a
 * browser-side wrapper around the /cluster/nextid API route. Each case seeds
 * one MSW handler; handlers reset between tests via jsdom-setup.
 */

import { describe, it, expect } from 'vitest'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { fetchNextVmid, usedVmidsOnConnection, nextVmidOnConnection } from './utils'

const CONN_ID = 'conn-1'
const NEXTID_URL = `*/api/v1/connections/${CONN_ID}/cluster/nextid`

describe('fetchNextVmid', () => {
  it('returns the cluster next id on a successful response', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({ data: 142 })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBe(142)
  })

  it('returns null when the response is not ok', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({}, { status: 500 })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })

  it('returns null when the id is below the 100 floor', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({ data: 42 })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })

  it('returns null when the payload is not a finite number', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.json({ data: 'nope' })))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })

  it('returns null when the request throws (network error)', async () => {
    server.use(http.get(NEXTID_URL, () => HttpResponse.error()))
    await expect(fetchNextVmid(CONN_ID)).resolves.toBeNull()
  })
})

// Two clusters, both numbering from 100, so 107 exists on each. This is the
// shape of the environment in #724.
const TWO_CLUSTERS = [
  { connId: 'conn-1', vmid: 100 },
  { connId: 'conn-1', vmid: '105' },
  { connId: 'conn-2', vmid: 107 },
  { connId: 'conn-2', vmid: 108 },
]

describe('usedVmidsOnConnection', () => {
  it('ignores guests living on another connection (#724)', () => {
    expect(usedVmidsOnConnection(TWO_CLUSTERS, 'conn-1')).toEqual([100, 105])
    expect(usedVmidsOnConnection(TWO_CLUSTERS, 'conn-2')).toEqual([107, 108])
  })

  it('drops unparseable vmids instead of yielding 0', () => {
    expect(usedVmidsOnConnection([{ connId: 'c', vmid: 'lxc' }, { connId: 'c', vmid: 110 }], 'c')).toEqual([110])
  })

  it('keeps every connection when no connection is selected yet', () => {
    expect(usedVmidsOnConnection(TWO_CLUSTERS, undefined)).toEqual([100, 105, 107, 108])
  })

  it('is empty for a connection with no guests', () => {
    expect(usedVmidsOnConnection(TWO_CLUSTERS, 'conn-3')).toEqual([])
  })
})

describe('nextVmidOnConnection', () => {
  it('does not skip ahead because of another cluster (#724)', () => {
    expect(nextVmidOnConnection(TWO_CLUSTERS, 'conn-1')).toBe(106)
  })

  it('starts at the 100 floor on an empty cluster', () => {
    expect(nextVmidOnConnection(TWO_CLUSTERS, 'conn-3')).toBe(100)
  })

  it('never proposes below the 100 floor', () => {
    expect(nextVmidOnConnection([{ connId: 'c', vmid: 42 }], 'c')).toBe(100)
  })
})
