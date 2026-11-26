/**
 * Risk acceptance of hardening checks, against a real Postgres schema: the
 * guards are mocked, the store and the audit wrapper's inputs are not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'

const h = vi.hoisted(() => ({
  requireEnterprise: vi.fn<() => Promise<Response | null>>(),
  denyIaasTenant: vi.fn<() => Promise<Response | null>>(),
  verifyConnectionOwnership: vi.fn<(id: string) => Promise<Response | null>>(),
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  getRBACContext: vi.fn<() => Promise<any>>(),
  tenantId: 'default',
  audit: vi.fn(async (_entry: Record<string, unknown>) => 'id'),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaTest }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireEnterprise: h.requireEnterprise }))
vi.mock('@/lib/tenant/iaasGuard', () => ({ denyIaasTenant: h.denyIaasTenant }))
vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: h.verifyConnectionOwnership,
  getCurrentTenantId: async () => h.tenantId,
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: h.checkPermission,
  getRBACContext: h.getRBACContext,
  PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' },
}))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/audit', () => ({ audit: h.audit }))

const route = await import('./route')
const { applyRiskAcceptances, listRiskAcceptances } = await import('@/lib/compliance/riskAcceptance')

const CONN = 'conn-acc-1'
const OTHER_CONN = 'conn-acc-2'
const now = new Date()
const JUSTIFICATION = 'Host firewall managed with firewalld on every node.'

const get = (connectionId = CONN) => callRoute(route.GET as any, { method: 'GET', params: { connectionId } })
const post = (body: unknown, connectionId = CONN) => callRoute(route.POST as any, { method: 'POST', params: { connectionId }, body: body as any })
const del = (checkId: string, connectionId = CONN) =>
  callRoute(route.DELETE as any, { method: 'DELETE', params: { connectionId }, searchParams: { checkId } })
const rows = () => prismaTest.complianceRiskAcceptance.findMany({ orderBy: { checkId: 'asc' } })

async function connection(id: string, tenantId = 'default') {
  // A provider-tenant PVE connection and its provider_connections row are
  // checked together by a deferred trigger: one transaction.
  await prismaTest.$transaction([
    prismaTest.connection.create({ data: { id, tenantId, name: id, baseUrl: 'https://pve.example.test:8006', apiTokenEnc: 'x' } }),
    prismaTest.providerConnection.create({ data: { connectionId: id } }),
  ])
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.tenantId = 'default'
  h.requireEnterprise.mockResolvedValue(null)
  h.denyIaasTenant.mockResolvedValue(null)
  h.verifyConnectionOwnership.mockResolvedValue(null)
  h.checkPermission.mockResolvedValue(null)
  h.getRBACContext.mockResolvedValue({ principal: { kind: 'session', userEmail: 'admin@example.test' } })
  await truncate(['compliance_risk_acceptances'])
  await prismaTest.connection.deleteMany({ where: { id: { in: [CONN, OTHER_CONN] } } })
  await prismaTest.tenant.upsert({
    where: { id: 'default' }, update: {},
    create: { id: 'default', slug: 'default', name: 'Default', enabled: true, createdAt: now, updatedAt: now },
  })
  await connection(CONN)
  await connection(OTHER_CONN)
})

describe('POST acceptances', () => {
  it('records who accepted the risk, why and until when', async () => {
    const expires = new Date(Date.now() + 30 * 86_400_000).toISOString()
    const res = await post({ check_id: 'node_firewalls', justification: `  ${JUSTIFICATION}  `, expires_at: expires })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toMatchObject({
      check_id: 'node_firewalls', justification: JUSTIFICATION, accepted_by: 'admin@example.test', expires_at: expires, active: true,
    })
    expect(await rows()).toMatchObject([
      { tenantId: 'default', connectionId: CONN, checkId: 'node_firewalls', justification: JUSTIFICATION, acceptedBy: 'admin@example.test' },
    ])
  })

  it('replaces the acceptance a check already has instead of adding a second one', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    await post({ check_id: 'node_firewalls', justification: 'Renewed after the yearly review.' })

    expect(await rows()).toMatchObject([{ checkId: 'node_firewalls', justification: 'Renewed after the yearly review.', expiresAt: null }])
  })

  it('names the API token when no user is signed in', async () => {
    h.getRBACContext.mockResolvedValue({ principal: { kind: 'token', tokenId: 'tok_1' } })
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    expect((await rows())[0].acceptedBy).toBe('API token tok_1')
  })

  it('refuses a bad body and writes nothing', async () => {
    for (const body of [null, { check_id: 'made_up', justification: JUSTIFICATION }, { check_id: 'node_firewalls', justification: 'short' }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(await rows()).toEqual([])
  })

  it('audits the acceptance under the connection', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', category: 'security', resourceType: 'compliance_risk_acceptance', resourceId: CONN, status: 'success',
    }))
  })
})

describe('GET acceptances', () => {
  it('lists the acceptances of this connection only, expired ones flagged', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    await post({ check_id: 'root_tfa', justification: JUSTIFICATION }, OTHER_CONN)
    await prismaTest.complianceRiskAcceptance.create({
      data: { id: 'expired', tenantId: 'default', connectionId: CONN, checkId: 'vm_firewalls', justification: JUSTIFICATION, acceptedBy: 'a@b.c', acceptedAt: now, expiresAt: new Date(Date.now() - 60_000) },
    })

    const data = (await readJson<any>(await get())).data as Array<{ check_id: string; active: boolean }>
    expect(data.map(a => [a.check_id, a.active]).sort()).toEqual([['node_firewalls', true], ['vm_firewalls', false]])
  })

  it('never shows another tenant the acceptances of a connection id', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    h.tenantId = 'tenant-other'
    expect((await readJson<any>(await get())).data).toEqual([])
  })
})

describe('DELETE acceptances', () => {
  it('revokes the acceptance, and answers 404 once it is gone', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })

    expect((await del('node_firewalls')).status).toBe(200)
    expect(await rows()).toEqual([])
    expect((await del('node_firewalls')).status).toBe(404)
  })

  it('refuses an unknown check id', async () => {
    expect((await del('made_up')).status).toBe(400)
  })

  it('leaves the same check of another connection alone', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION }, OTHER_CONN)
    await del('node_firewalls')
    expect((await rows()).map(r => r.connectionId)).toEqual([OTHER_CONN])
  })
})

describe('guards', () => {
  const denied = (status: number) => new Response(JSON.stringify({ error: 'no' }), { status })
  const calls = [() => get(), () => post({ check_id: 'node_firewalls', justification: JUSTIFICATION }), () => del('node_firewalls')]

  it.each([
    ['without an Enterprise licence', () => h.requireEnterprise.mockResolvedValue(denied(403)), 403],
    ['for an IaaS tenant', () => h.denyIaasTenant.mockResolvedValue(denied(404)), 404],
    ['on a connection of another tenant', () => h.verifyConnectionOwnership.mockResolvedValue(denied(404)), 404],
    ['without admin.compliance', () => h.checkPermission.mockResolvedValue(denied(403)), 403],
  ])('every handler is refused %s, and nothing is written', async (_label, arrange, status) => {
    arrange()
    for (const call of calls) expect((await call()).status).toBe(status)
    expect(await rows()).toEqual([])
  })

  it('asks for admin.compliance on the connection', async () => {
    await get()
    expect(h.checkPermission).toHaveBeenCalledWith('admin.compliance', 'connection', CONN)
  })

  it('answers 500 when the store throws', async () => {
    h.verifyConnectionOwnership.mockRejectedValue(new Error('boom'))
    for (const call of calls) expect((await call()).status).toBe(500)
  })
})

describe('the store behind the scan', () => {
  it('feeds applyRiskAcceptances, and goes with its connection', async () => {
    await post({ check_id: 'node_firewalls', justification: JUSTIFICATION })
    const check = { id: 'node_firewalls', name: 'Node firewalls enabled', category: 'node' as const, severity: 'medium' as const, maxPoints: 10, status: 'fail' as const, earned: 0 }

    const [applied] = applyRiskAcceptances([check], await listRiskAcceptances('default', CONN))
    expect(applied).toMatchObject({ status: 'accepted', rawStatus: 'fail', acceptance: { acceptedBy: 'admin@example.test' } })

    await prismaTest.connection.delete({ where: { id: CONN } })
    expect(await rows()).toEqual([])
  })
})
