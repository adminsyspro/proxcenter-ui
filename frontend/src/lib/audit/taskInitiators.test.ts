import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { findTaskInitiators } from './taskInitiators'

// Real Postgres: the lookup filters the JSONB `details` column.

const VNC_A = 'UPID:n1:00000001:00000001:65000000:vncproxy:100:proxcenter@pve!api:'
const VNC_B = 'UPID:n1:00000002:00000002:65000001:vncproxy:100:proxcenter@pve!api:'
const T0 = new Date('2026-10-08T10:00:00Z')

async function seed(id: string, tenantId: string, upid: string, user: { id?: string; email?: string; token?: string }, at = T0) {
  await prismaTest.auditLog.create({
    data: {
      id, tenantId, timestamp: at, action: 'console.open', category: 'vms',
      userId: user.id ?? null, userEmail: user.email ?? null, apiTokenId: user.token ?? null,
      details: { connectionId: 'c1', node: 'n1', upid },
    },
  })
}

beforeEach(async () => {
  await truncate(['audit_logs'])
})

describe('findTaskInitiators (roadmap#41)', () => {
  it('maps two consoles on the same VM to two distinct users', async () => {
    await seed('a1', 'default', VNC_A, { id: 'u1', email: 'alice@example.com' })
    await seed('a2', 'default', VNC_B, { id: 'u2', email: 'bob@example.com' })

    const map = await findTaskInitiators([VNC_A, VNC_B, 'UPID:unknown'], { tenantId: null, since: new Date(T0.getTime() - 60_000) })

    expect(map.get(VNC_A)).toEqual({ email: 'alice@example.com', apiTokenId: null })
    expect(map.get(VNC_B)?.email).toBe('bob@example.com')
    expect(map.has('UPID:unknown')).toBe(false)
  })

  it('keeps a tenant out of another tenant journal, the provider sees all', async () => {
    await seed('a1', 'default', VNC_A, { id: 'admin', email: 'provider@example.com' })
    await seed('a2', 'tenant-a', VNC_B, { id: 'u2', email: 'bob@tenant-a.example' })
    const since = new Date(T0.getTime() - 60_000)

    const tenant = await findTaskInitiators([VNC_A, VNC_B], { tenantId: 'tenant-a', since })
    expect(tenant.has(VNC_A)).toBe(false)
    expect(tenant.get(VNC_B)?.email).toBe('bob@tenant-a.example')

    const provider = await findTaskInitiators([VNC_A, VNC_B], { tenantId: null, since })
    expect(provider.size).toBe(2)
  })

  it('ignores rows older than the window and rows without any identity', async () => {
    await seed('old', 'default', VNC_A, { id: 'u1', email: 'alice@example.com' }, new Date(T0.getTime() - 3_600_000))
    await seed('anon', 'default', VNC_B, {})

    const map = await findTaskInitiators([VNC_A, VNC_B], { tenantId: null, since: new Date(T0.getTime() - 60_000) })
    expect(map.size).toBe(0)
  })

  it('attributes a token-driven task to the token', async () => {
    await seed('t1', 'default', VNC_A, { token: 'tok_1' })
    const map = await findTaskInitiators([VNC_A], { tenantId: null, since: new Date(T0.getTime() - 60_000) })
    expect(map.get(VNC_A)).toEqual({ email: null, apiTokenId: 'tok_1' })
  })

  it('narrows to the caller own rows without the audit right', async () => {
    await seed('a1', 'default', VNC_A, { id: 'u1', email: 'alice@example.com' })
    await seed('a2', 'default', VNC_B, { id: 'u2', email: 'bob@example.com' })
    const since = new Date(T0.getTime() - 60_000)

    const own = await findTaskInitiators([VNC_A, VNC_B], { tenantId: null, since, onlyFor: { userId: 'u1' } })
    expect([...own.keys()]).toEqual([VNC_A])
    expect((await findTaskInitiators([VNC_A, VNC_B], { tenantId: null, since, onlyFor: {} })).size).toBe(0)
  })

  it('skips the query entirely for an empty page', async () => {
    expect((await findTaskInitiators([], { tenantId: null, since: T0 })).size).toBe(0)
  })
})
