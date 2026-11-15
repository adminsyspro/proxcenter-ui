/**
 * Fixtures of the Overview tests: a policy on the Overview sub-tab, the suggestions route, the flow and suggestion factories.
 */

import { afterEach, vi } from 'vitest'

import { screen } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { flow, mock, policy, renderTab, reply, GUESTS_ROUTE, REVISION_HEAD } from './microsegTestKit'
import { db, suggestion, web } from './policyTestKit'

/** The map reads every pending observed flow (unprotected and blocked) at once. */
export const SUGGESTIONS = 'GET /suggestions?status=pending&limit=200'
const originalMatchMedia = window.matchMedia
afterEach(() => { window.matchMedia = originalMatchMedia })

export const flowOf = (id: string, over: Partial<MicrosegFlow> = {}): MicrosegFlow => ({ ...flow(id), src_zone_id: 'zw', dst_zone_id: 'zd', ...over })
export const wouldBlock = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  ...suggestion('2026-11-02T10:00:00Z'), id, src_zone_id: 'zw', dst_zone_id: 'zd', ...over,
})

export function setup(opts: {
  zones?: MicrosegZone[]
  flows?: MicrosegFlow[]
  suggestions?: MicrosegSuggestion[] | 'error'
  vms?: unknown[]
  pending_members?: PendingMember[]
  pending_changes?: boolean
  last_revision?: typeof REVISION_HEAD | null
} = {}) {
  window.localStorage.setItem('microseg.subTab', 'overview')
  mock.routes['GET /policy'] = () => reply(200, policy({
    zones: opts.zones ?? [web(), db()], flows: opts.flows ?? [], pending_members: opts.pending_members ?? [],
    pending_changes: opts.pending_changes ?? false, last_revision: opts.last_revision === undefined ? REVISION_HEAD : opts.last_revision,
  }))
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: opts.vms ?? [] } })
  mock.routes[SUGGESTIONS] = () => (opts.suggestions === 'error'
    ? reply(500, { code: 'ORCHESTRATOR_ERROR', error: 'boom' })
    : reply(200, { suggestions: opts.suggestions ?? [], limit: 200, offset: 0 }))
  return renderTab()
}

export const node = (id: string) => screen.findByTestId(`node-${id}`)
export const pathOf = (id: string) => screen.findByTestId(`path-${id}`)
export const reduceMotion = () => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

