/**
 * Shared fixtures of the Micro-segmentation tab tests: the Next relay is mocked
 * at the fetch level, so the real client (src/lib/microseg/api.ts) and hooks run.
 */

import { vi } from 'vitest'
import { SWRConfig } from 'swr'
import type { ReactElement } from 'react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow, MicrosegPolicy, MicrosegRevision, MicrosegStatus, MicrosegZone } from '@/lib/microseg/types'

import MicrosegTab from './MicrosegTab'

// The Overview sub-tab draws with @xyflow/react, which measures nothing in jsdom (no edge would be drawn) and
// whose stylesheet cannot go through the PostCSS config of the test run: every test that renders the tab gets this stand-in.
vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@xyflow/react', async () => (await import('./xyflowTestMock')).xyflowMock)

export const BASE = '/api/v1/firewall/microseg/c1'
/** The guest list of the connection, as the inventory route answers it. */
export const GUESTS_ROUTE = '/api/v1/vms?connId=c1'

export const zone = (id: string, over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id, policy_id: 'p1', name: id, label: '', color: '#3b82f6', enforcement: 'guest', vnet_id: '', state: 'observe',
  isolate_members: false, observe_since: null, ...over,
})
export const flow = (id: string): MicrosegFlow => ({
  id, policy_id: 'p1', src_zone_id: 'a', src_cidr: '', dst_zone_id: 'b', dst_cidr: '', proto: 'tcp', dport: '443',
  comment: '', origin: 'manual', created_by: 'me',
})

export const policy = (over: Partial<MicrosegPolicy> = {}): MicrosegPolicy => ({
  policy: {
    id: 'p1', connection_id: 'c1', tag_prefix: 'zone-', version: 3, settings: {} as never, emergency_stop: false,
    created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', updated_by: 'me',
  },
  zones: [], flows: [], pending_members: [], last_revision: null, version: 3, pending_changes: false, ...over,
})

export const status = (over: Partial<MicrosegStatus> = {}): MicrosegStatus => ({
  engine: { paused_until: null, held: false, last_runs: {}, last_log: null },
  coverage: { running: 5, zoned: 3, members: 3, protected: 2 },
  zones_by_state: { disabled: 1, observe: 2, enforce: 0 },
  emergency_stop: false,
  ...over,
})

export const REVISION_HEAD = { id: 'r1', version: 2, author: 'me', created_at: '2026-11-02T09:00:00Z' }
export const revisionWithSnapshot = (zones: MicrosegZone[], flows: MicrosegFlow[]): MicrosegRevision => ({
  ...REVISION_HEAD, snapshot: { tag_prefix: 'zone-', zones, flows },
})

export type Routes = Record<string, (init?: RequestInit) => unknown | Promise<unknown>>
export const reply = (httpStatus: number, body: unknown) => ({ ok: httpStatus < 400, status: httpStatus, text: async () => JSON.stringify(body) })

/** Keys are "METHOD /route" relative to the connection's relay base. */
export const mock: { routes: Routes } = { routes: {} }

export const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const key = `${init?.method ?? 'GET'} ${url.replace(BASE, '')}`
  const handler = mock.routes[key]
  if (!handler) return reply(404, { code: 'NOT_FOUND', error: `no mock for ${key}` })
  return handler(init)
})

export const calls = (key: string) =>
  fetchMock.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${(u as string).replace(BASE, '')}` === key)

/** Healthy defaults: a policy with a zone and a revision, a status, the last revision snapshot. */
export function resetMocks() {
  window.localStorage.clear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  mock.routes = {
    'GET /policy': () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD })),
    'GET /status': () => reply(200, status()),
    'GET /revisions?limit=1': () => reply(200, { revisions: [revisionWithSnapshot([zone('a')], [])] }),
    [`GET ${GUESTS_ROUTE}`]: () => reply(200, { data: { vms: [] } }),
  }
}

export function renderTab(ui: ReactElement = <MicrosegTab connectionId="c1" />) {
  return renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0 }}>{ui}</SWRConfig>,
  )
}
