/**
 * Unit tests for resolveInfraVisibility.
 *
 * Mock @/lib/tenant/infraScope and @/lib/rbac (the async halves only).
 * Pure helpers (pveConnectionFilter, isConnectionVisible) are tested via
 * the real modules so the combination logic is actually exercised.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  getTenantInfrastructureScopeMock,
  getRBACContextMock,
  getRbacInfraScopeMock,
} = vi.hoisted(() => ({
  getTenantInfrastructureScopeMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  getRbacInfraScopeMock: vi.fn(),
}))

vi.mock('@/lib/tenant/infraScope', async (orig) => {
  // Keep real pveConnectionFilter (pure), only stub the async loader.
  const real = await orig<typeof import('@/lib/tenant/infraScope')>()
  return {
    ...real,
    getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
  }
})

vi.mock('@/lib/rbac', async (orig) => {
  // Keep real isConnectionVisible (pure), only stub the async ones.
  const real = await orig<typeof import('@/lib/rbac')>()
  return {
    ...real,
    getRBACContext: (...a: any[]) => getRBACContextMock(...a),
    getRbacInfraScope: (...a: any[]) => getRbacInfraScopeMock(...a),
  }
})

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------
import { resolveInfraVisibility } from './infraVisibility'

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('resolveInfraVisibility', () => {
  it('provider tenant + super-admin -> enabled, null filter (all)', async () => {
    // Provider scope: pveConnectionFilter -> null
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    // Super-admin RBAC context: getRbacInfraScope -> null (unrestricted)
    getRBACContextMock.mockResolvedValue({ userId: 'u-admin', isAdmin: true, tenantId: 'default' })
    getRbacInfraScopeMock.mockResolvedValue(null)

    const r = await resolveInfraVisibility('default')
    expect(r).toEqual({ enabled: true, connectionFilter: null })
  })

  it('iaas tenant with empty visible set -> disabled', async () => {
    // iaas with no vDC connections -> pveConnectionFilter returns empty Set
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { connectionIds: new Set<string>() },
    })
    // No RBAC restriction (null)
    getRBACContextMock.mockResolvedValue(null)
    getRbacInfraScopeMock.mockResolvedValue(null)

    const r = await resolveInfraVisibility('t-iaas')
    expect(r.enabled).toBe(false)
    expect(r.connectionFilter).toBeInstanceOf(Set)
    expect((r.connectionFilter as Set<string>).size).toBe(0)
  })

  it('intersection of tenant filter and rbac scope', async () => {
    // msp tenant owning connections c1 + c2
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['c1', 'c2']),
    })
    // RBAC: c2 + c3 visible (c2 in fullConnections, c3 in nodesByConnection)
    getRBACContextMock.mockResolvedValue({ userId: 'u-msp', isAdmin: false, tenantId: 't-msp' })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(['c2']),
      nodesByConnection: new Map([['c3', new Set(['n1'])]]),
    })

    const r = await resolveInfraVisibility('t-msp')
    expect([...(r.connectionFilter ?? [])]).toEqual(['c2'])
    expect(r.enabled).toBe(true)
  })

  it('no rbac context (unauthenticated background call) -> treated as unrestricted', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    getRBACContextMock.mockResolvedValue(null)

    const r = await resolveInfraVisibility('default')
    expect(r).toEqual({ enabled: true, connectionFilter: null })
  })

  it('msp tenant, rbac null -> tenant filter is the filter', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['c1', 'c2']),
    })
    getRBACContextMock.mockResolvedValue({ userId: 'u-admin', isAdmin: true, tenantId: 't-msp' })
    getRbacInfraScopeMock.mockResolvedValue(null)

    const r = await resolveInfraVisibility('t-msp')
    expect(r.enabled).toBe(true)
    expect([...(r.connectionFilter ?? [])].sort()).toEqual(['c1', 'c2'])
  })

  it('tenant filter null, rbac restricts to c1 -> connectionFilter = {c1}', async () => {
    // Provider tenant (tenantFilter = null)
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    // But RBAC restricts to c1 only
    getRBACContextMock.mockResolvedValue({ userId: 'u-scoped', isAdmin: false, tenantId: 'default' })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(['c1']),
      nodesByConnection: new Map<string, Set<string>>(),
    })

    const r = await resolveInfraVisibility('default')
    expect(r.enabled).toBe(true)
    expect([...(r.connectionFilter ?? [])]).toEqual(['c1'])
  })
})
