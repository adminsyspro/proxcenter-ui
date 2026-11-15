/**
 * Shared fixtures of the Policy sub-tab tests: a policy on the Policy sub-tab,
 * guests as the inventory route answers them, suggestions and runs.
 */

import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import type { MicrosegFlow, MicrosegRun, MicrosegSuggestion, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { GUESTS_ROUTE, mock, policy, renderTab, reply, resetMocks, zone, REVISION_HEAD } from './microsegTestKit'

export const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

export const vm = (vmid: number, name: string, tags: string[], over: Record<string, unknown> = {}) => ({
  vmid: String(vmid), name, node: 'pve1', type: 'qemu', status: 'running', template: false, tags, ...over,
})

export const suggestion = (lastSeen: string): MicrosegSuggestion => ({
  id: 's1', policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.1', src_zone_id: 'zw', dst_ip: '10.0.0.2', dst_zone_id: '',
  proto: 'tcp', dport: '80', hits: 3, first_seen: lastSeen, last_seen: lastSeen, status: 'pending',
})

export const run = (status: MicrosegRun['status'], result: MicrosegRun['result'] = null): MicrosegRun => ({
  id: 'r1', policy_id: 'p1', kind: 'targeted', status, started_at: hoursAgo(0), duration_ms: 10, api_calls: 1, writes: 1, result, error: '',
})

export const body = (init?: RequestInit) => JSON.parse(String(init?.body))

/** The suggestions route the enforce dialog reads, for zone "zw". */
export const SUGGESTIONS_ROUTE = 'GET /suggestions?kind=would_block&status=pending&zone=zw&direction=in&limit=200'

/** A policy on the Policy sub-tab. */
export function setup(opts: {
  zones?: MicrosegZone[]
  flows?: MicrosegFlow[]
  pending_members?: PendingMember[]
  vms?: unknown[]
  /** The draft has unapplied changes. */
  pending_changes?: boolean
} = {}) {
  window.localStorage.setItem('microseg.subTab', 'policy')
  mock.routes['GET /policy'] = () => reply(200, policy({
    zones: opts.zones ?? [], flows: opts.flows ?? [], pending_members: opts.pending_members ?? [], last_revision: REVISION_HEAD,
    pending_changes: opts.pending_changes ?? false,
  }))
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: opts.vms ?? [] } })
  return renderTab()
}

export const web = (over: Partial<MicrosegZone> = {}) => zone('zw', { name: 'web', color: '#3b82f6', ...over })
export const db = (over: Partial<MicrosegZone> = {}) => zone('zd', { name: 'db', color: '#10b981', ...over })

/** beforeEach/afterEach every Policy test file needs. */
export function installFreshMocks() {
  beforeEach(resetMocks)
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
}
