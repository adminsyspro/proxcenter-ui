import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  headersMock, resolveVisibleMock, infraMock, guestScopeMock, creatorMock, creatorPermissionMock, getConnectionMock, auditMock,
} = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  resolveVisibleMock: vi.fn<(...args: any[]) => Promise<Set<string>>>(),
  infraMock: vi.fn<(...args: any[]) => Promise<any>>(),
  guestScopeMock: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  creatorMock: vi.fn<(...args: any[]) => Promise<boolean>>(),
  creatorPermissionMock: vi.fn<(...args: any[]) => Promise<boolean>>(),
  getConnectionMock: vi.fn<(...args: any[]) => Promise<any>>(),
  auditMock: vi.fn<(...args: any[]) => Promise<string>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('./scope', () => ({ resolveVisibleConnectionIds: resolveVisibleMock }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: infraMock }))
vi.mock('@/lib/vdc/guestScope', () => ({ checkTenantGuestsScope: guestScopeMock }))
vi.mock('./creatorCheck', () => ({ creatorStillHolds: creatorMock, creatorStillHoldsPermission: creatorPermissionMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionMock }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))

import { NextResponse } from 'next/server'

import { getAllowlistEntryById, matchEntryParams, type AllowlistEntry } from './allowlist'
import type { Principal } from '@/lib/auth/principal'
import { expandScopes } from './scopes'
import { auditTokenWrite, runTokenEntryGuards } from './writeGuards'

const principal: Principal = {
  kind: 'token',
  tokenId: 'tok-1',
  tenantId: 'tenant-x',
  creatorUserId: 'user-1',
  connectionIds: ['conn-a'],
  scopes: ['vms:write'],
  permissions: new Set(),
}

function entry(extra: Partial<AllowlistEntry> = {}): AllowlistEntry {
  return {
    id: 'test-write',
    method: 'POST',
    pattern: '/api/v1/connections/{id}/x',
    requiredScopes: ['vms:write'],
    connectionSegment: 'id',
    tag: 'VMs',
    routeFile: 'src/app/api/v1/x/route.ts',
    summary: 's',
    description: 'd',
    responseSchemaRef: 'R',
    ...extra,
  }
}

function getEntry(extra: Partial<AllowlistEntry> = {}): AllowlistEntry {
  return entry({ id: 'test-read', method: 'GET', requiredScopes: ['vms:read'], ...extra })
}

function post(body?: unknown, url = 'http://t/api/v1/x'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function setForwarded(method = 'POST', path = '/api/v1/connections/conn-a/x') {
  headersMock.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret',
    'x-pxc-method': method,
    'x-pxc-path': path,
    'x-pxc-entry': 'test-write',
  }))
}

function iaas() {
  return { kind: 'iaas', vdcScope: {} }
}

/** The single apitoken.denied audit written for the last refusal. */
function deniedAudit() {
  const calls = auditMock.mock.calls.filter(c => c[0]?.action === 'apitoken.denied')
  expect(calls).toHaveLength(1)
  return calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  setForwarded()
  resolveVisibleMock.mockResolvedValue(new Set(['conn-a', 'pbs-a']))
  infraMock.mockResolvedValue({ kind: 'provider' })
  guestScopeMock.mockResolvedValue(null)
  creatorMock.mockResolvedValue(true)
  creatorPermissionMock.mockResolvedValue(true)
  getConnectionMock.mockResolvedValue({ id: 'conn-a' })
  auditMock.mockResolvedValue('audit-id')
})

describe('runTokenEntryGuards', () => {
  it('passes (null) when every guard holds', async () => {
    expect(await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' })).toBeNull()
    expect(auditMock).not.toHaveBeenCalled()
  })

  describe('(1) forwarded method', () => {
    it('401 when x-pxc-method differs from the request method', async () => {
      setForwarded('GET')
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' })
      expect(res?.status).toBe(401)
      expect(await res?.json()).toEqual({ error: 'Invalid or expired API token' })
      expect(deniedAudit()).toMatchObject({ details: { status: 401, reason: 'invalid', entry: 'test-write' } })
      expect(resolveVisibleMock).not.toHaveBeenCalled()
    })

    it('401 when x-pxc-method is missing', async () => {
      headersMock.mockResolvedValue(new Headers())
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' })
      expect(res?.status).toBe(401)
    })

    it('HEAD rides on GET', async () => {
      setForwarded('HEAD')
      const req = new Request('http://t/api/v1/x', { method: 'HEAD' })
      expect(await runTokenEntryGuards(getEntry(), principal, req, { id: 'conn-a' })).toBeNull()
    })
  })

  describe('(2) primary connection', () => {
    it('403 when the connection segment is out of perimeter', async () => {
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-b' })
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-b' })
      expect(deniedAudit()).toMatchObject({
        action: 'apitoken.denied',
        category: 'api_tokens',
        status: 'failure',
        apiTokenId: 'tok-1',
        details: { status: 403, reason: 'Connection not in token scope', entry: 'test-write', tokenPrefix: 'pxc_abcdefgh' },
      })
      expect(resolveVisibleMock).toHaveBeenCalledWith(principal)
      expect(creatorMock).not.toHaveBeenCalled()
    })

    it('decodes the segment exactly once before the perimeter check', async () => {
      expect(await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn%2Da' })).toBeNull()
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn%2Db' })
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-b' })
    })

    describe('a value still escaped after the single decode (Ruling 32)', () => {
      it('401 on any path param, before any other guard', async () => {
        const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a', pos: '%252e%252e' })
        expect(res?.status).toBe(401)
        expect(resolveVisibleMock).not.toHaveBeenCalled()
        expect(deniedAudit()).toMatchObject({ details: { status: 401, entry: 'test-write' } })
      })

      it('401 on a GET entry too', async () => {
        setForwarded('GET')
        const res = await runTokenEntryGuards(getEntry(), principal, new Request('http://t/api/v1/x'), { id: 'conn%2525a' })
        expect(res?.status).toBe(401)
      })

      it('401 on a malformed escape in a segment the guard does not otherwise read', async () => {
        const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a', name: 'x%E0%A4%A' })
        expect(res?.status).toBe(401)
      })

      it('a single-encoded slash in the encodedSlashSegment still passes', async () => {
        const fw = getAllowlistEntryById('fw-ipset-entry-delete')!
        setForwarded('DELETE')
        const req = new Request('http://t/api/v1/x', { method: 'DELETE' })
        const params = { connectionId: 'conn-a', ipsetName: 'blocklist', cidr: '10.0.0.0%2F24' }
        expect(await runTokenEntryGuards(fw, principal, req, params)).toBeNull()
      })

      it.each([
        ['vm-config-update', 'PUT', '/api/v1/connections/conn-a/guests/qemu/pve1/1%2500/config'],
        ['pbs-backup-delete', 'DELETE', '/api/v1/pbs/pbs-a/backups/ds1%2Fvm%2F100%2F%2525'],
      ])('%s with a double-encoded (%%25) segment: 401', async (id, method, path) => {
        const real = getAllowlistEntryById(id)!
        const params = matchEntryParams(real, path)
        expect(params).not.toBeNull()
        setForwarded(method, path)
        const req = new Request(`http://t${path}`, { method, headers: { 'content-type': 'application/json' }, body: '{}' })
        const res = await runTokenEntryGuards(real, principal, req, params!)
        expect(res?.status).toBe(401)
        expect(resolveVisibleMock).not.toHaveBeenCalled()
      })
    })

    it('401 (fail closed) on a malformed percent escape', async () => {
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn%E0%A4%A' })
      expect(res?.status).toBe(401)
      expect(resolveVisibleMock).not.toHaveBeenCalled()
    })

    it('a GET entry keeps the read behaviour: segment checked, no creator check', async () => {
      setForwarded('GET')
      const req = new Request('http://t/api/v1/x')
      expect(await runTokenEntryGuards(getEntry(), principal, req, { id: 'conn-a' })).toBeNull()
      const res = await runTokenEntryGuards(getEntry(), principal, req, { id: 'conn-b' })
      expect(res?.status).toBe(403)
      expect(creatorMock).not.toHaveBeenCalled()
    })

    it('an entry declaring no connection never consults the perimeter', async () => {
      setForwarded('GET')
      const e = getEntry({ connectionSegment: undefined })
      expect(await runTokenEntryGuards(e, principal, new Request('http://t/x'), {})).toBeNull()
      expect(resolveVisibleMock).not.toHaveBeenCalled()
    })

    it('vmKeySegment: the connection is the first field of the decoded key', async () => {
      const e = entry({ connectionSegment: undefined, vmKeySegment: 'vmid' })
      expect(await runTokenEntryGuards(e, principal, post({}), { vmid: 'conn-a%3Aqemu%3Apve1%3A100' })).toBeNull()
      const res = await runTokenEntryGuards(e, principal, post({}), { vmid: 'conn-b:qemu:pve1:100' })
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-b' })
    })

    it('vmKeySegment: a key without exactly four fields is refused 401', async () => {
      const e = entry({ connectionSegment: undefined, vmKeySegment: 'vmid' })
      const res = await runTokenEntryGuards(e, principal, post({}), { vmid: 'conn-a:qemu:100' })
      expect(res?.status).toBe(401)
    })

    it('connectionField in the body: out of perimeter is 403, absent is 403 with a null connection', async () => {
      const e = entry({ connectionSegment: undefined, connectionField: { source: 'body', field: 'connectionId' } })
      expect(await runTokenEntryGuards(e, principal, post({ connectionId: 'conn-a' }), {})).toBeNull()
      const out = await runTokenEntryGuards(e, principal, post({ connectionId: 'conn-b' }), {})
      expect(await out?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-b' })
      const absent = await runTokenEntryGuards(e, principal, post({}), {})
      expect(absent?.status).toBe(403)
      expect(await absent?.json()).toEqual({ error: 'Connection not in token scope', connection: null })
    })

    it('connectionField in the body: a non-string value is refused', async () => {
      const e = entry({ connectionSegment: undefined, connectionField: { source: 'body', field: 'connectionId' } })
      const res = await runTokenEntryGuards(e, principal, post({ connectionId: ['conn-a', 'conn-b'] }), {})
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: null })
    })

    it('connectionField in the query: every repeated value is checked', async () => {
      const e = entry({ connectionSegment: undefined, connectionField: { source: 'query', field: 'connId' } })
      expect(await runTokenEntryGuards(e, principal, post({}, 'http://t/x?connId=conn-a'), {})).toBeNull()
      const res = await runTokenEntryGuards(e, principal, post({}, 'http://t/x?connId=conn-a&connId=conn-b'), {})
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-b' })
    })
  })

  describe('(3) secondary connections', () => {
    const e = entry({ secondaryConnections: [{ source: 'body', field: 'targetConnectionId' }] })

    it('403 for a body secondary out of perimeter, and the handler still reads the body intact', async () => {
      const body = { targetConnectionId: 'conn-z', vmid: 100 }
      const req = post(body)
      const res = await runTokenEntryGuards(e, principal, req, { id: 'conn-a' })
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-z' })
      expect(await req.json()).toEqual(body)
    })

    it('admits an in-perimeter secondary, and the handler still reads the body intact', async () => {
      const body = { targetConnectionId: 'pbs-a', vmid: 100 }
      const req = post(body)
      expect(await runTokenEntryGuards(e, principal, req, { id: 'conn-a' })).toBeNull()
      expect(await req.json()).toEqual(body)
    })

    it('an absent, null or empty secondary is not an error', async () => {
      expect(await runTokenEntryGuards(e, principal, post({}), { id: 'conn-a' })).toBeNull()
      expect(await runTokenEntryGuards(e, principal, post({ targetConnectionId: null }), { id: 'conn-a' })).toBeNull()
      expect(await runTokenEntryGuards(e, principal, post({ targetConnectionId: '' }), { id: 'conn-a' })).toBeNull()
    })

    it('a non-JSON or empty body yields no value (the handler stays the judge of its body)', async () => {
      const req = post('not json{')
      expect(await runTokenEntryGuards(e, principal, req, { id: 'conn-a' })).toBeNull()
      expect(await req.text()).toBe('not json{')
      expect(await runTokenEntryGuards(e, principal, post(), { id: 'conn-a' })).toBeNull()
    })

    it('a query secondary out of perimeter is 403', async () => {
      const q = entry({ secondaryConnections: [{ source: 'query', field: 'pbs' }] })
      const res = await runTokenEntryGuards(q, principal, post({}, 'http://t/x?pbs=pbs-z'), { id: 'conn-a' })
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'pbs-z' })
    })
  })

  describe('(4) cluster objects', () => {
    const e = entry({ clusterObject: true })

    it('403 for an iaas tenant token', async () => {
      infraMock.mockResolvedValue(iaas())
      const res = await runTokenEntryGuards(e, principal, post({}), { id: 'conn-a' })
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Cluster-level object not available to a vDC tenant token' })
      expect(infraMock).toHaveBeenCalledWith('tenant-x', { ignoreVdcContext: true })
      expect(deniedAudit().details.reason).toBe('Cluster-level object not available to a vDC tenant token')
    })

    it('passes for an msp tenant (it owns its connection) and for the provider', async () => {
      infraMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-a']) })
      expect(await runTokenEntryGuards(e, principal, post({}), { id: 'conn-a' })).toBeNull()
      infraMock.mockResolvedValue({ kind: 'provider' })
      expect(await runTokenEntryGuards(e, principal, post({}), { id: 'conn-a' })).toBeNull()
    })

    it('an entry that is not a cluster object never resolves the tenant scope', async () => {
      expect(await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' })).toBeNull()
      expect(infraMock).not.toHaveBeenCalled()
    })
  })

  describe('(5) guest vDC scope', () => {
    const pathEntry = entry({
      pattern: '/api/v1/connections/{id}/guests/{type}/{node}/{vmid}/x',
      guestScope: { connection: 'id', type: 'type', node: 'node', vmid: 'vmid' },
    })
    const pathParams = { id: 'conn-a', type: 'qemu', node: 'pve1', vmid: '100' }

    it('iaas: path segments are decoded and handed to checkTenantGuestsScope', async () => {
      infraMock.mockResolvedValue(iaas())
      const params = { ...pathParams, node: 'pve%2D1' }
      expect(await runTokenEntryGuards(pathEntry, principal, post({}), params)).toBeNull()
      expect(getConnectionMock).toHaveBeenCalledWith('conn-a', 'tenant-x')
      expect(guestScopeMock).toHaveBeenCalledWith('tenant-x', { id: 'conn-a' }, 'conn-a', 'qemu', 'pve-1', ['100'], false)
    })

    it('iaas: allowMovedNode is forwarded only when the entry declares it', async () => {
      infraMock.mockResolvedValue(iaas())
      const moved = entry({ ...pathEntry, guestScope: { connection: 'id', type: 'type', node: 'node', vmid: 'vmid', allowMovedNode: true } })
      expect(await runTokenEntryGuards(moved, principal, post({}), pathParams)).toBeNull()
      expect(guestScopeMock).toHaveBeenLastCalledWith('tenant-x', { id: 'conn-a' }, 'conn-a', 'qemu', 'pve1', ['100'], true)
      await runTokenEntryGuards(pathEntry, principal, post({}), pathParams)
      expect(guestScopeMock.mock.lastCall?.[6]).toBe(false)
    })

    it('iaas: the helper refusal is returned and audited', async () => {
      infraMock.mockResolvedValue(iaas())
      guestScopeMock.mockResolvedValue(NextResponse.json({ error: 'Guest outside your vDC scope' }, { status: 403 }))
      const res = await runTokenEntryGuards(pathEntry, principal, post({}), pathParams)
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Guest outside your vDC scope' })
      expect(deniedAudit().details).toMatchObject({ status: 403, reason: 'Guest outside your vDC scope' })
      expect(creatorMock).not.toHaveBeenCalled()
    })

    it('non-iaas tenants are not confined by the guest guard', async () => {
      infraMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-a']) })
      expect(await runTokenEntryGuards(pathEntry, principal, post({}), pathParams)).toBeNull()
      expect(guestScopeMock).not.toHaveBeenCalled()
      expect(getConnectionMock).not.toHaveBeenCalled()
    })

    it('iaas: vmKey shape parses conn:type:node:vmid', async () => {
      infraMock.mockResolvedValue(iaas())
      const e = entry({ connectionSegment: undefined, vmKeySegment: 'vmid', guestScope: { vmKey: 'vmid' } })
      expect(await runTokenEntryGuards(e, principal, post({}), { vmid: 'conn-a:lxc:pve2:205' })).toBeNull()
      expect(guestScopeMock).toHaveBeenCalledWith('tenant-x', { id: 'conn-a' }, 'conn-a', 'lxc', 'pve2', ['205'], false)
    })

    describe('vmidField', () => {
      const e = entry({
        pattern: '/api/v1/connections/{id}/nodes/{node}/vzdump',
        guestScope: { connection: 'id', vmidField: { source: 'body', field: 'vmid' } },
      })

      it('a body vmid is checked with any type and any node (null, null)', async () => {
        infraMock.mockResolvedValue(iaas())
        const req = post({ vmid: 100, storage: 'pbs' })
        expect(await runTokenEntryGuards(e, principal, req, { id: 'conn-a', node: 'pve1' })).toBeNull()
        expect(guestScopeMock).toHaveBeenCalledWith('tenant-x', { id: 'conn-a' }, 'conn-a', null, null, ['100'], false)
        expect(await req.json()).toEqual({ vmid: 100, storage: 'pbs' })
      })

      it('a comma-separated vmid list is checked in one call, the guests listed once', async () => {
        infraMock.mockResolvedValue(iaas())
        guestScopeMock.mockResolvedValue(NextResponse.json({ error: 'Guest outside your vDC scope' }, { status: 403 }))
        const res = await runTokenEntryGuards(e, principal, post({ vmid: '100, 101' }), { id: 'conn-a' })
        expect(res?.status).toBe(403)
        expect(guestScopeMock).toHaveBeenCalledTimes(1)
        expect(guestScopeMock).toHaveBeenCalledWith('tenant-x', { id: 'conn-a' }, 'conn-a', null, null, ['100', '101'], false)
      })

      it('an absent or non-numeric vmid is refused for an iaas token (nothing to confine)', async () => {
        infraMock.mockResolvedValue(iaas())
        const absent = await runTokenEntryGuards(e, principal, post({ all: 1 }), { id: 'conn-a' })
        expect(absent?.status).toBe(403)
        expect(await absent?.json()).toEqual({ error: 'Guest outside your vDC scope' })
        const bogus = await runTokenEntryGuards(e, principal, post({ vmid: '100;rm' }), { id: 'conn-a' })
        expect(bogus?.status).toBe(403)
        expect(guestScopeMock).not.toHaveBeenCalled()
      })

      it('a query vmid is read from the query string', async () => {
        infraMock.mockResolvedValue(iaas())
        const q = entry({ guestScope: { connection: 'id', vmidField: { source: 'query', field: 'vmid' } } })
        expect(await runTokenEntryGuards(q, principal, post({}, 'http://t/x?vmid=300'), { id: 'conn-a' })).toBeNull()
        expect(guestScopeMock).toHaveBeenCalledWith('tenant-x', { id: 'conn-a' }, 'conn-a', null, null, ['300'], false)
      })
    })

    it('iaas: the guest connection must itself be in the perimeter', async () => {
      infraMock.mockResolvedValue(iaas())
      const e = entry({
        connectionSegment: undefined,
        perimeter: 'handler',
        guestScope: { connection: 'id', type: 'type', node: 'node', vmid: 'vmid' },
      })
      const res = await runTokenEntryGuards(e, principal, post({}), { ...pathParams, id: 'conn-b' })
      expect(await res?.json()).toEqual({ error: 'Connection not in token scope', connection: 'conn-b' })
      expect(guestScopeMock).not.toHaveBeenCalled()
    })

    it('iaas: 503 when the connection cannot be loaded', async () => {
      infraMock.mockResolvedValue(iaas())
      getConnectionMock.mockRejectedValue(new Error('Connection conn-a has no baseUrl'))
      const res = await runTokenEntryGuards(pathEntry, principal, post({}), pathParams)
      expect(res?.status).toBe(503)
      expect(await res?.json()).toEqual({ error: 'Unable to verify guest vDC scope' })
    })
  })

  describe('(6) live creator check', () => {
    it('403 naming the scope when the creator no longer holds it', async () => {
      creatorMock.mockResolvedValue(false)
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' })
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Token creator no longer holds this right', scope: 'vms:write' })
      expect(creatorMock).toHaveBeenCalledWith(
        { tokenId: 'tok-1', tenantId: 'tenant-x', creatorUserId: 'user-1', connectionIds: ['conn-a'] },
        'vms:write',
      )
      expect(deniedAudit().details.reason).toBe('Token creator no longer holds this right')
    })

    it('a creator check that rejects is a deny, never a pass or a 500', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      creatorMock.mockRejectedValue(new Error('db down: secret details'))
      const res = await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' })
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'Token creator no longer holds this right', scope: 'vms:write' })
      errSpy.mockRestore()
    })

    it('a deleted creator (null) is passed as null', async () => {
      creatorMock.mockResolvedValue(false)
      const orphan = { ...principal, creatorUserId: null }
      await runTokenEntryGuards(entry(), orphan, post({}), { id: 'conn-a' })
      expect(creatorMock.mock.calls[0][0].creatorUserId).toBeNull()
    })

    describe('secondary permissions the token holds (Ruling 35)', () => {
      const creatorToken = { tokenId: 'tok-1', tenantId: 'tenant-x', creatorUserId: 'user-1', connectionIds: ['conn-a'] }
      const withScopes = (...scopes: string[]): Principal => ({ ...principal, scopes, permissions: expandScopes(scopes) })

      it('vm-restore: a creator stripped of vm.delete cannot force-overwrite through a vms:delete token', async () => {
        creatorPermissionMock.mockImplementation(async (_t, key) => key !== 'vm.delete')
        const restore = getAllowlistEntryById('vm-restore')!
        const res = await runTokenEntryGuards(restore, withScopes('backups:restore', 'vms:delete'), post({}), { id: 'conn-a', node: 'pve1' })
        expect(res?.status).toBe(403)
        expect(await res?.json()).toEqual({ error: 'Token creator no longer holds this right', permission: 'vm.delete' })
        expect(creatorPermissionMock).toHaveBeenCalledWith(creatorToken, 'vm.delete')
        expect(deniedAudit().details).toMatchObject({ status: 403, reason: 'Token creator no longer holds this right', entry: 'vm-restore' })
      })

      it('vm-remote-migrate-prepare: a creator stripped of node.manage is refused through an ha:write token', async () => {
        creatorPermissionMock.mockImplementation(async (_t, key) => key !== 'node.manage')
        const prepare = getAllowlistEntryById('vm-remote-migrate-prepare')!
        const params = { id: 'conn-a', type: 'qemu', node: 'pve1', vmid: '100' }
        const res = await runTokenEntryGuards(prepare, withScopes('vms:migrate', 'vms:snapshot', 'ha:write'), post({}), params)
        expect(res?.status).toBe(403)
        expect(await res?.json()).toEqual({ error: 'Token creator no longer holds this right', permission: 'node.manage' })
        expect(creatorPermissionMock).toHaveBeenCalledWith(creatorToken, 'vm.snapshot')
      })

      it('passes when the creator still holds every secondary key the token holds', async () => {
        const prepare = getAllowlistEntryById('vm-remote-migrate-prepare')!
        const params = { id: 'conn-a', type: 'qemu', node: 'pve1', vmid: '100' }
        expect(await runTokenEntryGuards(prepare, withScopes('vms:migrate', 'vms:snapshot', 'ha:write'), post({}), params)).toBeNull()
        expect(creatorPermissionMock.mock.calls.map(c => c[1])).toEqual(['vm.snapshot', 'node.manage'])
      })

      it('a secondary key the token does not hold is not checked (the handler refuses it anyway)', async () => {
        creatorPermissionMock.mockResolvedValue(false)
        const restore = getAllowlistEntryById('vm-restore')!
        expect(await runTokenEntryGuards(restore, withScopes('backups:restore'), post({}), { id: 'conn-a', node: 'pve1' })).toBeNull()
        expect(creatorPermissionMock).not.toHaveBeenCalled()
      })

      it('a secondary check that rejects is a deny, never a pass', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        creatorPermissionMock.mockRejectedValue(new Error('db down'))
        const restore = getAllowlistEntryById('vm-restore')!
        const res = await runTokenEntryGuards(restore, withScopes('backups:restore', 'vms:delete'), post({}), { id: 'conn-a', node: 'pve1' })
        expect(res?.status).toBe(403)
        errSpy.mockRestore()
      })

      it('the scope verdict comes first: a lost scope never reaches the secondary check', async () => {
        creatorMock.mockResolvedValue(false)
        const restore = getAllowlistEntryById('vm-restore')!
        const res = await runTokenEntryGuards(restore, withScopes('backups:restore', 'vms:delete'), post({}), { id: 'conn-a', node: 'pve1' })
        expect(await res?.json()).toEqual({ error: 'Token creator no longer holds this right', scope: 'backups:restore' })
        expect(creatorPermissionMock).not.toHaveBeenCalled()
      })
    })

    it('runs last: an earlier refusal never reaches the creator check', async () => {
      infraMock.mockResolvedValue(iaas())
      const res = await runTokenEntryGuards(entry({ clusterObject: true }), principal, post({}), { id: 'conn-a' })
      expect(res?.status).toBe(403)
      expect(creatorMock).not.toHaveBeenCalled()
    })
  })
})

describe('runTokenEntryGuards: a lookup that throws (scope unverifiable)', () => {
  const guestEntry = entry({
    pattern: '/api/v1/connections/{id}/guests/{type}/{node}/{vmid}/x',
    guestScope: { connection: 'id', type: 'type', node: 'node', vmid: 'vmid' },
  })
  const guestParams = { id: 'conn-a', type: 'qemu', node: 'pve1', vmid: '100' }
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => { errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => errSpy.mockRestore())

  async function expectUnverifiable(res: Response | null) {
    expect(res?.status).toBe(503)
    expect(await res?.json()).toEqual({ error: 'Unable to verify token scope' })
    expect(deniedAudit().details).toMatchObject({ status: 503, reason: 'Unable to verify token scope', entry: 'test-write' })
    expect(creatorMock).not.toHaveBeenCalled()
  }

  it('the perimeter resolution', async () => {
    resolveVisibleMock.mockRejectedValue(new Error('db down: secret'))
    await expectUnverifiable(await runTokenEntryGuards(entry(), principal, post({}), { id: 'conn-a' }))
  })

  it('the tenant infrastructure scope', async () => {
    infraMock.mockRejectedValue(new Error('db down'))
    await expectUnverifiable(await runTokenEntryGuards(entry({ clusterObject: true }), principal, post({}), { id: 'conn-a' }))
  })

  it('the guest vDC scope helper (its own infra lookup)', async () => {
    infraMock.mockResolvedValue(iaas())
    guestScopeMock.mockRejectedValue(new Error('db down'))
    await expectUnverifiable(await runTokenEntryGuards(guestEntry, principal, post({}), guestParams))
  })
})

describe('auditTokenWrite', () => {
  it('journals a write with entry, method, path, HTTP status and the UPID of the response', async () => {
    const res = NextResponse.json({ data: 'UPID:pve1:0001:0002:0003:qmstart:100:root@pam:' })
    await auditTokenWrite(entry(), principal, post({}), res)
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toEqual({
      action: 'apitoken.write',
      category: 'api_tokens',
      resourceType: 'api_token',
      resourceId: 'tok-1',
      apiTokenId: 'tok-1',
      status: 'success',
      details: {
        entry: 'test-write',
        method: 'POST',
        path: '/api/v1/connections/conn-a/x',
        httpStatus: 200,
        upid: 'UPID:pve1:0001:0002:0003:qmstart:100:root@pam:',
      },
    })
    // The response sent to the client is untouched.
    expect(await res.json()).toEqual({ data: 'UPID:pve1:0001:0002:0003:qmstart:100:root@pam:' })
  })

  it('reads the UPID from data.upid too (the /guests/{vmid} envelope), only when it is one', async () => {
    const upid = 'UPID:pve1:0001:0002:0003:qmsnapshot:100:root@pam:'
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json({ data: { success: true, upid } }))
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json({ data: { upid: 'not-a-task' } }))
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json({ data: null }))
    expect(auditMock.mock.calls.map(c => c[0].details.upid)).toEqual([upid, null, null])
  })

  it('journals every UPID of a multi-task answer (data.tasks[].upid) as upids, only real ones', async () => {
    const a = 'UPID:pve1:0001:0002:0003:vzdump::root@pam:'
    const b = 'UPID:pve2:0001:0002:0003:vzdump::root@pam:'
    const run = { data: { tasks: [{ node: 'pve1', upid: a }, { node: 'pve2', upid: b }, { node: 'pve3', upid: 'forged' }, { node: 'pve4' }], errors: [] } }
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json(run))
    expect(auditMock.mock.calls[0][0].details).toMatchObject({ upid: null, upids: [a, b] })
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json({ data: a }))
    expect(auditMock.mock.calls[1][0].details).not.toHaveProperty('upids')
  })

  it('a failed write is journaled as a failure, without a UPID', async () => {
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json({ error: 'nope' }, { status: 409 }))
    expect(auditMock.mock.calls[0][0]).toMatchObject({ status: 'failure', details: { httpStatus: 409, upid: null } })
  })

  it('a non-JSON or non-UPID response carries no UPID', async () => {
    await auditTokenWrite(entry(), principal, post({}), new Response('ok', { status: 200 }))
    await auditTokenWrite(entry(), principal, post({}), NextResponse.json({ data: 'done' }))
    expect(auditMock.mock.calls.map(c => c[0].details.upid)).toEqual([null, null])
  })

  it('a read entry is never journaled', async () => {
    await auditTokenWrite(getEntry(), principal, new Request('http://t/x'), NextResponse.json({ data: [] }))
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('an audit that throws never throws out of auditTokenWrite', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    auditMock.mockRejectedValue(new Error('db down'))
    await expect(auditTokenWrite(entry(), principal, post({}), NextResponse.json({ data: 'x' }))).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
