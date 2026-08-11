/**
 * Enforcement-surface regression test: injectVdcNodeScope pins node_pattern
 * for orchestrator alert rules. It MUST resolve the tenant's FULL union
 * (ignoreVdcContext: true), never the vDC view-context-narrowed scope --
 * otherwise a rule created for a connection outside the active context
 * would skip node-pinning entirely and fire on other tenants' nodes.
 *
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/alerts/ruleScopeContext.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVdcScopeMock } = vi.hoisted(() => ({
  getVdcScopeMock: vi.fn(),
}))

vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: getVdcScopeMock }))

import { injectVdcNodeScope } from './ruleScope'

beforeEach(() => {
  getVdcScopeMock.mockReset()
  getVdcScopeMock.mockResolvedValue({
    nodesByConnection: new Map([['conn-1', new Set(['node-a', 'node-b'])]]),
  })
})

describe('injectVdcNodeScope', () => {
  it('resolves getVdcScope with the { ignoreVdcContext: true } opt-out (enforcement surface, not a view)', async () => {
    const body: { connection_id?: string; node_pattern?: string } = { connection_id: 'conn-1' }
    await injectVdcNodeScope(body, 'tenant-1')

    expect(getVdcScopeMock).toHaveBeenCalledWith('tenant-1', { ignoreVdcContext: true })
    expect(body.node_pattern).toBe('^(node-a|node-b)$')
  })
})
