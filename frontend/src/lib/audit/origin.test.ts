// The "via assistant" tag (roadmap#188): rows written while an approved
// action runs carry who asked for it, and every other row is left untouched.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { forwardMock } = vi.hoisted(() => ({ forwardMock: vi.fn<(event: Record<string, unknown>) => Promise<void>>(async () => {}) }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next-auth', () => ({ getServerSession: async () => null }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/syslog/forwarder', () => ({ forwardAuditEvent: forwardMock }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'

import { audit } from './index'
import { runWithAuditOrigin } from './origin'

const ORIGIN = { via: 'assistant' as const, conversationId: 'conv-1', actionId: 'act-1' }

async function rowOf(id: string) {
  return prismaTest.auditLog.findUnique({ where: { id } })
}

async function rows() {
  return prismaTest.auditLog.findMany()
}

beforeEach(async () => {
  forwardMock.mockClear()
  await truncate(['audit_logs'])
})

describe('auditOrigin', () => {
  it('leaves details unchanged outside an origin', async () => {
    const details = { node: 'pve1', via: 'ui' }
    const row = await rowOf(await audit({ action: 'start', category: 'vms', details, tenantId: 'default' }))

    expect(row?.details).toEqual({ node: 'pve1', via: 'ui' })
    expect(forwardMock.mock.calls[0][0]).toMatchObject({ details })
  })

  it('keeps a row without details null outside an origin', async () => {
    const row = await rowOf(await audit({ action: 'start', category: 'vms', tenantId: 'default' }))

    expect(row?.details).toBeNull()
  })

  it('merges the origin into details, its keys winning, the others kept', async () => {
    const id = await runWithAuditOrigin(ORIGIN, () =>
      audit({ action: 'start', category: 'vms', details: { node: 'pve1', via: 'forged', actionId: 'other' }, tenantId: 'default' })
    )
    const row = await rowOf(id)

    expect(row?.details).toEqual({ node: 'pve1', via: 'assistant', conversationId: 'conv-1', actionId: 'act-1' })
    expect(forwardMock.mock.calls[0][0]).toMatchObject({ details: { node: 'pve1', via: 'assistant', actionId: 'act-1' } })
  })

  it('tags a row that had no details', async () => {
    const id = await runWithAuditOrigin(ORIGIN, () => audit({ action: 'start', category: 'vms', tenantId: 'default' }))

    expect((await rowOf(id))?.details).toEqual(ORIGIN)
  })

  it('does not tag a row that work started inside the dispatch writes after it returned', async () => {
    let late: Promise<string> | undefined
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })

    await runWithAuditOrigin(ORIGIN, async () => {
      // Background work the handler started and did not wait for: a timer, an unawaited promise.
      late = gate.then(() => audit({ action: 'sync', category: 'vms', details: { a: 1 }, tenantId: 'default' }))
    })
    release()

    expect((await rowOf(await late!))?.details).toEqual({ a: 1 })
  })

  it('still tags a row the dispatch fired without awaiting it', async () => {
    let fired: Promise<string> | undefined

    await runWithAuditOrigin(ORIGIN, async () => {
      fired = audit({ action: 'start', category: 'vms', details: { a: 1 }, tenantId: 'default' })
    })

    expect((await rowOf(await fired!))?.details).toEqual({ a: 1, ...ORIGIN })
  })

  it('tags the rows written inside the dispatch and returns its value', async () => {
    const result = await runWithAuditOrigin(ORIGIN, async () => {
      await audit({ action: 'start', category: 'vms', tenantId: 'default' })

      return 42
    })

    expect(result).toBe(42)
    expect((await rows())[0].details).toEqual(ORIGIN)
  })

  it('does not leak past its run', async () => {
    await runWithAuditOrigin(ORIGIN, async () => {})
    const row = await rowOf(await audit({ action: 'start', category: 'vms', details: { a: 1 }, tenantId: 'default' }))

    expect(row?.details).toEqual({ a: 1 })
  })
})
