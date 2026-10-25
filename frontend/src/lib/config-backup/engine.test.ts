import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prismaTest, testSchema } from '@/__tests__/setup/prisma-test'

import { compareMigrations, dumpConfiguration, isBackupPayload, restoreConfiguration, summarizeBackup, type BackupPayload } from './engine'

function keyed(secret: string) {
  const key = createHash('sha256').update(secret).digest()

  return {
    encrypt(plain: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
    },
    decrypt(payload: string) {
      const [iv, tag, data] = payload.split('.')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
    },
  }
}

const source = keyed('source-install')
const target = keyed('target-install')
const s = (table: string) => `"${testSchema}"."${table}"`

// The restore replaces whole tables of the shared test schema: take the state
// the previous test files left, and put it back at the end.
let initial: BackupPayload

beforeAll(async () => {
  initial = (await dumpConfiguration(prismaTest, testSchema, source.decrypt)).payload

  // Two orchestrator-owned tables, which Prisma migrations do not create.
  await prismaTest.$executeRawUnsafe(
    `CREATE TABLE ${s('replication_jobs')} (id text PRIMARY KEY, name text, status text, run_holder text, run_heartbeat_at timestamptz)`,
  )
  await prismaTest.$executeRawUnsafe(`CREATE TABLE ${s('restore_drill_settings')} (id bigserial PRIMARY KEY, max_concurrent int)`)
})

afterAll(async () => {
  await prismaTest.$executeRawUnsafe(`DROP TABLE IF EXISTS ${s('replication_jobs')}, ${s('restore_drill_settings')}`)
  await restoreConfiguration(prismaTest, testSchema, initial, source.encrypt)
})

describe('configuration backup engine', () => {
  it('restores tenants, connections and settings as they were, with secrets moved to the local key', async () => {
    const now = new Date()
    await prismaTest.tenant.create({ data: { id: 'cb-tenant', slug: 'cb-tenant', name: 'Backup Co', operatingModel: 'msp', createdAt: now, updatedAt: now } })
    await prismaTest.connection.create({
      data: { id: 'cb-conn', tenantId: 'cb-tenant', name: 'PVE-CB', baseUrl: 'https://10.0.0.1:8006', apiTokenEnc: source.encrypt('root@pam!cb=secret'), tags: 'prod;dc1' },
    })
    await prismaTest.setting.create({ data: { key: 'cb.config', tenantId: 'default', value: { ranges: ['10.0.0.0/24'] } } })
    await prismaTest.setting.create({ data: { key: 'syslog_orchestrator_cursor', tenantId: 'default', value: { at: 'before' } } })
    await prismaTest.$executeRawUnsafe(`INSERT INTO ${s('replication_jobs')} VALUES ('job-1', 'nightly', 'active', 'node-a', now())`)
    await prismaTest.$executeRawUnsafe(`INSERT INTO ${s('restore_drill_settings')} (id, max_concurrent) VALUES (7, 2)`)
    await prismaTest.user.create({ data: { id: 'cb-user', email: 'cb-user@example.com', createdAt: now, updatedAt: now } })
    await prismaTest.session.create({ data: { id: 'cb-sess', userId: 'cb-user', createdAt: now, lastSeenAt: now } })

    const { payload, secrets } = await dumpConfiguration(prismaTest, testSchema, source.decrypt)
    expect(secrets).toBeGreaterThanOrEqual(1)
    expect(payload.migration).toMatch(/^\d{14}_/)
    expect(payload.tables.Connection.find(r => r.id === 'cb-conn')?.apiTokenEnc).toMatch(/^\{\{pcx-secret:/)
    expect(payload.tables.settings.map(r => r.key)).not.toContain('syslog_orchestrator_cursor')

    // What happens between the backup and the restore.
    await prismaTest.connection.delete({ where: { id: 'cb-conn' } })
    await prismaTest.tenant.update({ where: { id: 'cb-tenant' }, data: { name: 'Renamed' } })
    await prismaTest.tenant.create({ data: { id: 'cb-later', slug: 'cb-later', name: 'Later', operatingModel: 'iaas', createdAt: now, updatedAt: now } })
    await prismaTest.setting.update({ where: { key_tenantId: { key: 'syslog_orchestrator_cursor', tenantId: 'default' } }, data: { value: { at: 'after' } } })
    await prismaTest.user.create({ data: { id: 'cb-gone', email: 'cb-gone@example.com', createdAt: now, updatedAt: now } })
    await prismaTest.session.create({ data: { id: 'cb-gone-sess', userId: 'cb-gone', createdAt: now, lastSeenAt: now } })

    const result = await restoreConfiguration(prismaTest, testSchema, JSON.parse(JSON.stringify(payload)), target.encrypt)
    expect(result.rows).toBeGreaterThan(0)
    expect(result.secrets).toBe(secrets)

    const conn = await prismaTest.connection.findUniqueOrThrow({ where: { id: 'cb-conn' } })
    expect(conn.tags).toBe('prod;dc1')
    expect(target.decrypt(conn.apiTokenEnc)).toBe('root@pam!cb=secret')
    expect((await prismaTest.tenant.findUniqueOrThrow({ where: { id: 'cb-tenant' } })).name).toBe('Backup Co')
    expect(await prismaTest.tenant.findUnique({ where: { id: 'cb-later' } })).toBeNull()
    // A session outlives the restore when its user is in the backup.
    expect(await prismaTest.session.findUnique({ where: { id: 'cb-sess' } })).not.toBeNull()
    expect(await prismaTest.session.findUnique({ where: { id: 'cb-gone-sess' } })).toBeNull()
    // Runtime state outside the export is neither restored nor wiped.
    const cursor = await prismaTest.setting.findUniqueOrThrow({ where: { key_tenantId: { key: 'syslog_orchestrator_cursor', tenantId: 'default' } } })
    expect(cursor.value).toEqual({ at: 'after' })

    const [job] = await prismaTest.$queryRawUnsafe<{ status: string; run_holder: string; run_heartbeat_at: Date | null }[]>(
      `SELECT status, run_holder, run_heartbeat_at FROM ${s('replication_jobs')}`,
    )
    expect(job).toEqual({ status: 'paused', run_holder: '', run_heartbeat_at: null })

    await prismaTest.$executeRawUnsafe(`INSERT INTO ${s('restore_drill_settings')} (max_concurrent) VALUES (1)`)
    const ids = await prismaTest.$queryRawUnsafe<{ id: bigint }[]>(`SELECT id FROM ${s('restore_drill_settings')} ORDER BY id`)
    expect(ids.map(r => Number(r.id))).toEqual([7, 8])
  })

  it('drops rows pointing at a permission this install does not know, and reports unknown tables', async () => {
    const now = new Date()
    await prismaTest.rbacRole.upsert({ where: { id: 'cb-role' }, update: {}, create: { id: 'cb-role', name: 'cb-role', createdAt: now, updatedAt: now } })
    const { payload } = await dumpConfiguration(prismaTest, testSchema, source.decrypt)
    payload.tables.rbac_role_permissions = [...payload.tables.rbac_role_permissions, { role_id: 'cb-role', permission_id: 'perm.does.not.exist' }]
    payload.tables.not_a_table = [{ id: 1 }]

    const summary = await summarizeBackup(prismaTest, testSchema, payload)
    expect(summary.compatibility).toBe('same')
    expect(summary.unknownTables).toEqual(['not_a_table'])
    expect(summary.sections.find(x => x.key === 'tenants')?.rows).toBe(payload.tables.tenants.length)

    const result = await restoreConfiguration(prismaTest, testSchema, payload, source.encrypt)
    expect(result.skippedTables).toEqual(['not_a_table'])
    const unknown = await prismaTest.rbacRolePermission.count({ where: { permissionId: 'perm.does.not.exist' } })
    expect(unknown).toBe(0)
  })

  it('rolls everything back when one insert fails', async () => {
    const before = await prismaTest.tenant.count()
    const { payload } = await dumpConfiguration(prismaTest, testSchema, source.decrypt)
    payload.tables.vdcs = [{ id: 'broken', tenant_id: 'no-such-tenant', connection_id: 'nope', name: 'x', slug: 'x', pve_pool_name: 'x' }]

    await expect(restoreConfiguration(prismaTest, testSchema, payload, source.encrypt)).rejects.toThrow()
    expect(await prismaTest.tenant.count()).toBe(before)
  })
})

describe('compareMigrations / isBackupPayload', () => {
  it('orders migrations by their timestamp prefix', () => {
    expect(compareMigrations('20260101000000_a', '20260101000000_a')).toBe('same')
    expect(compareMigrations('20250101000000_a', '20260101000000_b')).toBe('older')
    expect(compareMigrations('20270101000000_a', '20260101000000_b')).toBe('newer')
    expect(compareMigrations(null, '20260101000000_b')).toBe('unknown')
  })

  it('accepts only a map of row arrays', () => {
    expect(isBackupPayload({ migration: null, tables: { t: [{ a: 1 }] } })).toBe(true)
    expect(isBackupPayload({ tables: { t: [1] } })).toBe(false)
    expect(isBackupPayload({ tables: [] })).toBe(false)
    expect(isBackupPayload(null)).toBe(false)
  })
})
