/**
 * Unit tests for hardware/utils.ts — currently fetchNextVmid.
 *
 * Runs in the jsdom lane (MSW-backed fetch) because fetchNextVmid is a
 * browser-side wrapper around the /cluster/nextid API route. Each case seeds
 * one MSW handler; handlers reset between tests via jsdom-setup.
 */

import { describe, it, expect } from 'vitest'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { fetchNextVmid } from './utils'

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
