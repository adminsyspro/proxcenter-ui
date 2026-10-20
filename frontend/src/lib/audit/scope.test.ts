import { beforeEach, describe, expect, it, vi } from 'vitest'

const { headersMock, getServerSessionMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/syslog/forwarder', () => ({ forwardAuditEvent: vi.fn(async () => {}) }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { audit } from './index'
import { auditScope, markAuditExplicit, type AuditScope } from './scope'

beforeEach(async () => {
  headersMock.mockResolvedValue(new Headers())
  getServerSessionMock.mockResolvedValue(null)
  await truncate(['audit_logs', 'tenants'])
  await seedDefaultTenant()
})

describe('audit scope', () => {
  it('is a no-op outside a scope', () => {
    expect(auditScope.getStore()).toBeUndefined()
    expect(() => markAuditExplicit()).not.toThrow()
  })

  it('is flagged by the real audit() before its first await, and the row carries source=app', async () => {
    const scope: AuditScope = { explicit: false }
    const id = await auditScope.run(scope, async () => {
      const pending = audit({ action: 'create', category: 'ha', userEmail: 'system:auto-ha' })
      expect(scope.explicit).toBe(true)
      return pending
    })

    const row = await prismaTest.auditLog.findUnique({ where: { id } })
    expect(row?.source).toBe('app')
    expect(row?.userEmail).toBe('system:auto-ha')
  })

  it('keeps one scope per run', async () => {
    const a: AuditScope = { explicit: false }
    const b: AuditScope = { explicit: false }
    await Promise.all([
      auditScope.run(a, async () => {
        await Promise.resolve()
        markAuditExplicit()
      }),
      auditScope.run(b, async () => {
        await Promise.resolve()
      }),
    ])
    expect(a.explicit).toBe(true)
    expect(b.explicit).toBe(false)
  })
})
