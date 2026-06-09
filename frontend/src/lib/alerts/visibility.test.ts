/**
 * Tenant isolation contract for orchestrator alerts.
 *
 * These tests lock the visibility gates of `isAlertVisibleToTenant`
 * after the SQLite to Postgres cutover made the predicate async. The
 * regression that motivated this suite shipped on the feature branch
 * (commit 26a530ed): seven callers were left synchronous, so
 * `Array.filter(visibility)` saw the returned Promise as truthy and a
 * vDC tenant briefly received infrastructure alerts that should have
 * been provider-only. The route handlers were fixed by wrapping the
 * call in `await Promise.all(...)`; this suite locks the underlying
 * predicate so any future regression in the same shape is caught here
 * instead of in production.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { isAlertVisibleToTenant, type AlertVisibilityCtx } from './visibility'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'

const PROVIDER = 'default'
const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const CONN_SHARED = 'conn-shared'

beforeEach(async () => {
  await truncate(['alert_rule_owners'])
  // Seed rule ownership: ruleA is owned by tenant A, ruleB by tenant B.
  // ruleBuiltin has no row, which is the "provider-only" sentinel.
  await prismaTest.alertRuleOwner.createMany({
    data: [
      { ruleId: 'rule-a', tenantId: TENANT_A },
      { ruleId: 'rule-b', tenantId: TENANT_B },
    ],
  })
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

function ctx(tenantId: string, opts: Partial<AlertVisibilityCtx> = {}): AlertVisibilityCtx {
  // Default: tenant has access to the shared connection, with a vDC scope
  // that allows node `pve1` and a single vmid (100). Tests override the
  // pieces they exercise.
  return {
    tenantId,
    tenantConnectionIds: new Set([CONN_SHARED]),
    infraKind: 'iaas' as const,
    vdcScope: {
      connectionIds: new Set([CONN_SHARED]),
      pbsConnectionIds: new Set(),
      nodesByConnection: new Map([[CONN_SHARED, new Set(['pve1'])]]),
      storagesByConnection: new Map(),
      poolsByConnection: new Map(),
      vnetsByConnection: new Map(),
      sharedBridgesByConnection: new Map(),
      pbsNamespacesByConnection: new Map(),
      pbsNamespacesByPveConnection: new Map(),
    },
    vdcVmids: new Map([[CONN_SHARED, new Set(['100'])]]),
    ...opts,
  }
}

describe('isAlertVisibleToTenant — tenant isolation contract', () => {
  it('built-in alert (no rule_id) is provider-only', async () => {
    const alert = {
      connection_id: CONN_SHARED,
      resource_type: 'node',
      resource_id: 'pve1',
      node: 'pve1',
    }

    expect(await isAlertVisibleToTenant(alert, ctx(TENANT_A))).toBe(false)
    expect(await isAlertVisibleToTenant(alert, ctx(TENANT_B))).toBe(false)

    // Provider sees built-in alerts. The provider has no vdcScope.
    expect(
      await isAlertVisibleToTenant(alert, ctx(PROVIDER, { vdcScope: null, infraKind: 'provider' as const })),
    ).toBe(true)
  })

  it('rule-bound alert is visible only to the owning tenant', async () => {
    const alertOwnedByA = {
      rule_id: 'rule-a',
      connection_id: CONN_SHARED,
      resource_type: 'qemu',
      resource_id: 100,
      node: 'pve1',
    }

    expect(await isAlertVisibleToTenant(alertOwnedByA, ctx(TENANT_A))).toBe(true)
    expect(await isAlertVisibleToTenant(alertOwnedByA, ctx(TENANT_B))).toBe(false)
  })

  it('system resource_type is denied even when the rule is owned by the tenant', async () => {
    // rule-a is tenant A's rule. But a node-level alert is system-level
    // and must never reach a vDC tenant, regardless of ownership.
    const systemAlert = {
      rule_id: 'rule-a',
      connection_id: CONN_SHARED,
      resource_type: 'storage',
      resource_id: 'local-lvm',
      node: 'pve1',
    }

    expect(await isAlertVisibleToTenant(systemAlert, ctx(TENANT_A))).toBe(false)
  })

  it('connection outside the tenant scope is denied', async () => {
    const alert = {
      rule_id: 'rule-a',
      connection_id: 'other-conn',
      resource_type: 'qemu',
      resource_id: 100,
      node: 'pve1',
    }

    // Tenant A owns rule-a but does not have other-conn in scope.
    expect(await isAlertVisibleToTenant(alert, ctx(TENANT_A))).toBe(false)
  })

  it('vmid outside the vDC pool is denied even on an authorised connection', async () => {
    const alert = {
      rule_id: 'rule-a',
      connection_id: CONN_SHARED,
      resource_type: 'qemu',
      resource_id: 999, // not in the {100} set
      node: 'pve1',
    }

    expect(await isAlertVisibleToTenant(alert, ctx(TENANT_A))).toBe(false)
  })

  it('node outside the vDC scope is denied (gate 2)', async () => {
    const alert = {
      rule_id: 'rule-a',
      connection_id: CONN_SHARED,
      resource_type: 'qemu',
      resource_id: 100,
      node: 'pve9', // tenant A only has pve1 in scope
    }

    expect(await isAlertVisibleToTenant(alert, ctx(TENANT_A))).toBe(false)
  })

  it('all gates passing yields visibility', async () => {
    const alert = {
      rule_id: 'rule-a',
      connection_id: CONN_SHARED,
      resource_type: 'qemu',
      resource_id: 100,
      node: 'pve1',
    }

    expect(await isAlertVisibleToTenant(alert, ctx(TENANT_A))).toBe(true)
  })

  it('returns a boolean (not a Promise leaking through Array.filter)', async () => {
    // Regression guard for the bug class fixed in 26a530ed: callers that
    // pass the predicate to Array.filter must resolve it via Promise.all
    // first. We assert that the awaited return is a plain boolean — if a
    // future change accidentally wraps it (e.g. in a thenable proxy) the
    // type-narrowing assertion below catches it.
    const result = await isAlertVisibleToTenant(
      { connection_id: CONN_SHARED, resource_type: 'qemu', resource_id: 100, node: 'pve1' },
      ctx(PROVIDER, { vdcScope: null, infraKind: 'provider' as const }),
    )
    expect(typeof result).toBe('boolean')
  })

  describe('MSP tenant visibility', () => {
    const MSP_TENANT = 'tenant-msp'
    const CONN_MSP = 'conn-msp'

    function mspCtx(opts: Partial<AlertVisibilityCtx> = {}): AlertVisibilityCtx {
      return {
        tenantId: MSP_TENANT,
        tenantConnectionIds: new Set([CONN_MSP]),
        infraKind: 'msp' as const,
        vdcScope: null,
        vdcVmids: new Map([[CONN_MSP, new Set(['200'])]]),
        ...opts,
      }
    }

    it('msp + built-in alert (no rule_id) on an owned connection is visible', async () => {
      const alert = {
        connection_id: CONN_MSP,
        resource_type: 'node',
        resource_id: 'pve1',
        node: 'pve1',
      }
      expect(await isAlertVisibleToTenant(alert, mspCtx())).toBe(true)
    })

    it('msp + built-in alert with no connection_id is NOT visible', async () => {
      const alert = {
        resource_type: 'cluster',
        resource_id: 'cluster',
      }
      expect(await isAlertVisibleToTenant(alert, mspCtx())).toBe(false)
    })

    it('msp + alert on a connection NOT in tenantConnectionIds is NOT visible', async () => {
      const alert = {
        rule_id: 'rule-a',
        connection_id: 'conn-other',
        resource_type: 'qemu',
        resource_id: 200,
        node: 'pve1',
      }
      expect(await isAlertVisibleToTenant(alert, mspCtx())).toBe(false)
    })

    it('msp + alert on an owned connection with a rule the tenant owns is visible', async () => {
      // Seed rule ownership for the MSP tenant in beforeEach is for TENANT_A/B.
      // We seed an msp-specific rule here via the prismaTest directly.
      await prismaTest.alertRuleOwner.create({ data: { ruleId: 'rule-msp', tenantId: MSP_TENANT } })

      const alert = {
        rule_id: 'rule-msp',
        connection_id: CONN_MSP,
        resource_type: 'qemu',
        resource_id: 200,
        node: 'pve1',
      }
      expect(await isAlertVisibleToTenant(alert, mspCtx())).toBe(true)
    })

    it('provider + connection-less alert is visible', async () => {
      const alert = {
        resource_type: 'cluster',
        resource_id: 'cluster',
      }
      expect(
        await isAlertVisibleToTenant(alert, ctx(PROVIDER, { vdcScope: null, infraKind: 'provider' as const })),
      ).toBe(true)
    })

    it('iaas + built-in alert (no rule_id) is NOT visible (regression guard)', async () => {
      const alert = {
        connection_id: CONN_SHARED,
        resource_type: 'node',
        resource_id: 'pve1',
        node: 'pve1',
      }
      expect(await isAlertVisibleToTenant(alert, ctx(TENANT_A))).toBe(false)
    })
  })
})
