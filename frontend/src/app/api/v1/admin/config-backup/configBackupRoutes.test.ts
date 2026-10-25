import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { sealBackup } from '@/lib/config-backup/envelope'
import { installKeyCheck } from '@/lib/config-backup/http'

const { providerGateMock, superAdminMock, sessionMock, auditMock, dumpMock, summarizeMock, restoreMock, installMock } = vi.hoisted(() => ({
  providerGateMock: vi.fn(),
  superAdminMock: vi.fn(),
  sessionMock: vi.fn(),
  auditMock: vi.fn(),
  dumpMock: vi.fn(),
  summarizeMock: vi.fn(),
  restoreMock: vi.fn(),
  installMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: providerGateMock }))
vi.mock('@/lib/auth/totp-admin', () => ({ requireSuperAdminCaller: superAdminMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/config/version', () => ({ APP_VERSION: '9.9.9' }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { installIdentity: { findFirst: installMock } }, databaseSchema: 'public' }))
vi.mock('@/lib/crypto/secret', () => ({ encryptSecret: (s: string) => s, decryptSecret: (s: string) => s }))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return auditMock(...a) } }
})
vi.mock('@/lib/config-backup/engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/config-backup/engine')>('@/lib/config-backup/engine')
  return { ...actual, dumpConfiguration: dumpMock, summarizeBackup: summarizeMock, restoreConfiguration: restoreMock }
})

import { POST as exportPost } from './export/route'
import { POST as importPost } from './import/route'
import { POST as inspectPost } from './inspect/route'

const PASSPHRASE = 'correct horse battery'
const payload = { migration: '20261023120000_x', tables: { tenants: [{ id: 'default' }], Connection: [{ id: 'pve-prod-marker' }, { id: 'pve-dr-marker' }] } }

async function upload(passphrase = PASSPHRASE, content?: string, body: object = payload) {
  const form = new FormData()
  form.set('file', new Blob([content ?? (await sealBackup(body, PASSPHRASE, '1.4.12', new Date('2026-10-25T08:00:00Z')))]), 'backup.json')
  form.set('passphrase', passphrase)
  return form
}

function summary(compatibility: string) {
  return { migration: payload.migration, compatibility, sections: [{ key: 'connections', rows: 2 }], unknownTables: [] }
}

beforeEach(() => {
  for (const m of [providerGateMock, superAdminMock, sessionMock, auditMock, dumpMock, summarizeMock, restoreMock, installMock]) m.mockReset()
  installMock.mockResolvedValue({ id: 'install-a' })
  providerGateMock.mockResolvedValue(null)
  superAdminMock.mockResolvedValue(null)
  sessionMock.mockResolvedValue({ user: { id: 'u1', email: 'admin@example.com' } })
})

describe('config backup routes: access', () => {
  it('refuses a caller outside the provider tenant before reading anything', async () => {
    providerGateMock.mockResolvedValue(new Response(null, { status: 403 }))

    for (const [handler, body] of [[exportPost, { passphrase: PASSPHRASE }], [inspectPost, await upload()], [importPost, await upload()]] as const) {
      const res = await callRoute(handler, { method: 'POST', body })
      expect(res.status).toBe(403)
    }
    expect(dumpMock).not.toHaveBeenCalled()
    expect(restoreMock).not.toHaveBeenCalled()
  })

  it('refuses a provider caller who is not a super admin', async () => {
    superAdminMock.mockResolvedValue(new Response(null, { status: 403 }))

    const res = await callRoute(exportPost, { method: 'POST', body: { passphrase: PASSPHRASE } })
    expect(res.status).toBe(403)
    expect(dumpMock).not.toHaveBeenCalled()
  })
})

describe('POST export', () => {
  it('refuses a short passphrase', async () => {
    const res = await callRoute(exportPost, { method: 'POST', body: { passphrase: 'short' } })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toMatchObject({ code: 'passphrase-too-short' })
  })

  it('answers an encrypted download and audits the export', async () => {
    dumpMock.mockResolvedValue({ payload, secrets: 4 })

    const res = await callRoute(exportPost, { method: 'POST', body: { passphrase: PASSPHRASE } })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="proxcenter-config-\d{8}-\d{6}\.json"/)
    const file = await res.text()
    expect(JSON.parse(file)).toMatchObject({ format: 'proxcenter-config-backup', appVersion: '9.9.9' })
    expect(file).not.toContain(installKeyCheck())
    expect(file).not.toContain('install-a')
    expect(file).not.toContain('pve-prod-marker')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'export', details: expect.objectContaining({ rows: 3, secrets: 4 }) }))
  })
})

describe('POST inspect', () => {
  it('describes the file', async () => {
    summarizeMock.mockResolvedValue(summary('same'))

    const res = await callRoute(inspectPost, { method: 'POST', body: await upload() })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { createdAt: '2026-10-25T08:00:00.000Z', appVersion: '1.4.12', ...summary('same') } })
  })

  it.each([
    ['a wrong passphrase', () => upload('not the passphrase'), 'wrong-passphrase'],
    ['a file that is not a backup', () => upload(PASSPHRASE, '{"hello":1}'), 'invalid-file'],
    ['no file', async () => { const f = new FormData(); f.set('passphrase', PASSPHRASE); return f }, 'missing-file'],
  ])('answers 400 for %s', async (_, body, code) => {
    const res = await callRoute(inspectPost, { method: 'POST', body: await body() })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toMatchObject({ code })
  })
})

describe('POST import', () => {
  it('restores the file and audits it under the caller taken before the restore', async () => {
    summarizeMock.mockResolvedValue(summary('older'))
    restoreMock.mockResolvedValue({ tables: 2, rows: 3, secrets: 0, skippedTables: [] })

    const res = await callRoute(importPost, { method: 'POST', body: await upload() })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { tables: 2, rows: 3, secrets: 0, skippedTables: [], apiTokensInvalid: false, otherInstall: false } })
    expect(restoreMock).toHaveBeenCalledWith(expect.anything(), 'public', payload, expect.any(Function))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'import', userId: 'u1', userEmail: 'admin@example.com' }))
  })

  it.each([
    ['another install key', 'deadbeefdeadbeef', true],
    ['this install key', null, false],
  ])('flags restored API tokens written under %s', async (_, keyCheck, invalid) => {
    summarizeMock.mockResolvedValue(summary('same'))
    restoreMock.mockResolvedValue({ tables: 1, rows: 1, secrets: 0, skippedTables: [] })
    const body = { ...payload, tables: { ...payload.tables, api_tokens: [{ id: 't1' }] }, keyCheck: keyCheck ?? installKeyCheck() }

    const res = await callRoute(importPost, { method: 'POST', body: await upload(PASSPHRASE, undefined, body) })

    expect(await readJson(res)).toMatchObject({ data: { apiTokensInvalid: invalid } })
  })

  it.each([
    ['another install', 'install-b', true],
    ['this install', 'install-a', false],
    ['an install that did not record its identity', undefined, false],
  ])('tells whether the file comes from %s', async (_, sourceInstall, other) => {
    summarizeMock.mockResolvedValue(summary('same'))
    restoreMock.mockResolvedValue({ tables: 1, rows: 1, secrets: 0, skippedTables: [] })

    const res = await callRoute(importPost, { method: 'POST', body: await upload(PASSPHRASE, undefined, { ...payload, sourceInstall }) })

    expect(await readJson(res)).toMatchObject({ data: { otherInstall: other } })
  })

  it('refuses a backup written by a newer schema', async () => {
    summarizeMock.mockResolvedValue(summary('newer'))

    const res = await callRoute(importPost, { method: 'POST', body: await upload() })

    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ code: 'newer-schema' })
    expect(restoreMock).not.toHaveBeenCalled()
  })
})
