// Generic contract of every API token write entry (and of the GET neighbours
// opened with them). Each domain task appends its ids to EXPECTED_WRITE_IDS;
// everything else below applies to the new entries automatically.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn<() => Promise<Headers>>() }))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn<() => Promise<null>>().mockResolvedValue(null) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { truncate } from '@/__tests__/setup/prisma-test'
import { ENTERPRISE_WITH_API_ACCESS, seedApiToken, seedDefaultTenant, tokenHeaders } from '@/__tests__/setup/apiTokens'
import { getPrincipal } from '@/lib/auth/principal'
import { _impl } from '@/lib/auth/requireEnterprise'
import { PERMISSIONS, grantsPermission } from '@/lib/rbac'

import { PUBLIC_API_ALLOWLIST, getAllowlistEntryById, isWriteEntry, matchPublicApiPath, matchesEntry, type AllowlistEntry } from './allowlist'
import { _resetLicenseVerdictCache } from './licenseGate'
import { _resetRateLimitCounters } from './rateLimit'
import { READ_SCOPE_IDS, WRITE_SCOPE_IDS, expandScopes, isWriteScope } from './scopes'

/** Write entry ids, per domain task. A missing or an undeclared write entry fails. */
const EXPECTED_WRITE_IDS: Record<string, string[]> = {
  vms: [
    'vm-create', 'vm-config-update', 'vm-power', 'vm-clone', 'vm-template',
    'vm-disk-resize', 'vm-disk-move', 'vm-unlock', 'vm-migrate', 'vm-remote-migrate',
    'vm-remote-migrate-check', 'vm-remote-migrate-prepare', 'vm-delete', 'vm-notes-update',
    'vm-snapshot-create', 'vm-snapshot-delete', 'vm-snapshot-rollback', 'vm-snapshot-update',
  ],
  backups: [
    'backup-job-create', 'backup-job-update', 'backup-job-delete', 'backup-job-run', 'backup-job-guests',
    'vm-backup-now', 'vm-restore', 'pbs-backup-delete', 'pbs-backup-verify',
    'pbs-job-prune-create', 'pbs-job-sync-create', 'pbs-job-verify-create', 'pbs-job-tape-create',
    'pbs-job-prune-update', 'pbs-job-sync-update', 'pbs-job-verify-update', 'pbs-job-tape-update',
    'pbs-job-prune-delete', 'pbs-job-sync-delete', 'pbs-job-verify-delete', 'pbs-job-tape-delete',
    'pbs-job-sync-run', 'pbs-job-verify-run', 'pbs-job-tape-run', 'pbs-job-gc-run',
    'gfr-probe', 'gfr-job-create', 'gfr-job-cancel',
  ],
}

/** The only entries allowed to resolve their connection inside the handler. */
const HANDLER_PERIMETER_IDS = ['gfr-probe', 'gfr-job-create', 'gfr-job-cancel', 'vdc-vnet-create', 'vdc-vnet-update', 'vdc-vnet-delete']

/** GET handlers of a file opened in write that stay closed (spec: consoles only). */
const CLOSED_GET_NEIGHBOUR_FILES: string[] = []

const FRONTEND_ROOT = path.resolve(__dirname, '..', '..', '..')
const writeEntries = PUBLIC_API_ALLOWLIST.filter(isWriteEntry)

function routeSource(entry: AllowlistEntry): string {
  return readFileSync(path.join(FRONTEND_ROOT, entry.routeFile), 'utf8')
}

/** {x} -> x1, an enum segment -> its first value, a vmKey segment -> a parseable key. */
function samplePath(entry: AllowlistEntry): string {
  const vmKey = entry.vmKeySegment ?? (entry.guestScope && 'vmKey' in entry.guestScope ? entry.guestScope.vmKey : null)
  return entry.pattern.split('/').map(segment => {
    if (!segment.startsWith('{') || !segment.endsWith('}')) return segment
    const name = segment.slice(1, -1)
    const allowed = entry.segmentEnum?.[name]
    if (allowed) return allowed[0]
    return name === vmKey ? 'x1:qemu:n1:100' : `${name}1`
  }).join('/')
}

function hasBodyField(entry: AllowlistEntry): boolean {
  const guest = entry.guestScope
  return entry.connectionField?.source === 'body' ||
    (entry.secondaryConnections ?? []).some(f => f.source === 'body') ||
    (!!guest && 'vmidField' in guest && guest.vmidField.source === 'body')
}

const byRouteFile = new Map<string, AllowlistEntry[]>()
for (const entry of PUBLIC_API_ALLOWLIST) {
  byRouteFile.set(entry.routeFile, [...(byRouteFile.get(entry.routeFile) ?? []), entry])
}
/** Route files opened in write, with every entry (GET neighbours included) pointing at them. */
const writeRouteFiles = [...byRouteFile.entries()].filter(([, entries]) => entries.some(isWriteEntry))

describe('write contract: declared entries', () => {
  it('the write entries are exactly EXPECTED_WRITE_IDS', () => {
    const expected = Object.values(EXPECTED_WRITE_IDS).flat()
    expect(new Set(expected).size).toBe(expected.length)
    expect(writeEntries.map(e => e.id).sort()).toEqual([...expected].sort())
  })

  it.each(PUBLIC_API_ALLOWLIST.map(e => [e.id, e] as const))('(a) %s is the guarded export of its route file', (_id, entry) => {
    expect(routeSource(entry)).toContain(`export const ${entry.method} = withPublicApiGuard("${entry.id}"`)
  })

  it.each(writeEntries.map(e => [e.id, e] as const))('(b, c) %s needs one write scope and declares its perimeter', (_id, entry) => {
    expect(entry.requiredScopes).toHaveLength(1)
    expect(isWriteScope(entry.requiredScopes[0])).toBe(true)
    expect(!!(entry.connectionSegment || entry.vmKeySegment || entry.connectionField || entry.perimeter === 'handler')).toBe(true)
  })

  it('(c) perimeter "handler" is reserved to HANDLER_PERIMETER_IDS', () => {
    const handlerResolved = PUBLIC_API_ALLOWLIST.filter(e => e.perimeter === 'handler').map(e => e.id)
    expect(handlerResolved.filter(id => !HANDLER_PERIMETER_IDS.includes(id))).toEqual([])
  })

  // (d) only sees literal PERMISSIONS.X in the route file itself, not keys
  // built at runtime (classifier, NIC helpers) nor those checked in imported modules.
  it.each(writeRouteFiles)('(d) every permission checked in %s is granted by its entries', (file, entries) => {
    const granted = new Set<string>()
    for (const entry of entries) {
      for (const key of expandScopes(entry.requiredScopes)) granted.add(key)
      for (const key of entry.secondaryPermissions ?? []) granted.add(key)
    }
    const source = readFileSync(path.join(FRONTEND_ROOT, file), 'utf8')
    const names = [...new Set([...source.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)].map(m => m[1]))]
    const permissions = PERMISSIONS as Record<string, string>
    for (const name of names) expect(permissions[name], `unknown PERMISSIONS.${name}`).toBeDefined()
    expect(names.filter(name => !grantsPermission(granted, permissions[name]))).toEqual([])
  })

  it.each(PUBLIC_API_ALLOWLIST.filter(hasBodyField).map(e => [e.id, e] as const))(
    '%s reads a body field, so its handler parses a JSON body (the guards read JSON only)',
    (_id, entry) => {
      expect(routeSource(entry)).toMatch(/\.json\(\)/)
    },
  )

  it('every GET of a file opened in write is opened too, with the scopes of its write neighbours', () => {
    for (const [file, entries] of writeRouteFiles) {
      if (CLOSED_GET_NEIGHBOUR_FILES.includes(file)) continue
      const writes = entries.filter(isWriteEntry)
      const source = readFileSync(path.join(FRONTEND_ROOT, file), 'utf8')
      const exportsGet = /export\s+(?:async\s+)?(?:function|const|let)\s+GET\b|export\s*\{[^}]*\bGET\b/.test(source)
      const gets = entries.filter(e => e.method === 'GET')
      expect(gets.length, `${file} exports GET`).toBe(exportsGet ? 1 : 0)
      for (const get of gets) {
        expect(get.requiredScopes.some(s => !isWriteScope(s)), `${get.id} lists a read scope`).toBe(true)
        for (const write of writes) expect(get.requiredScopes).toEqual(expect.arrayContaining(write.requiredScopes))
      }
    }
  })

  it('(f) no (method, sample path) matches two entries, and the shared matcher picks its own', () => {
    for (const entry of PUBLIC_API_ALLOWLIST) {
      const sample = samplePath(entry)
      expect(matchPublicApiPath(sample, entry.method).entryId, sample).toBe(entry.id)
      const others = PUBLIC_API_ALLOWLIST.filter(o => o.id !== entry.id && matchesEntry(o, sample, entry.method))
      expect(others.map(o => o.id), sample).toEqual([])
    }
  })
})

describe('write contract: a read-only token is refused every write (getPrincipal)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    _resetLicenseVerdictCache()
    _resetRateLimitCounters()
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
    await truncate(['api_tokens', 'users', 'tenants', 'security_policies'])
    await seedDefaultTenant()
  })

  it('(e) a token with the 7 read scopes gets 403 on each write entry', async () => {
    expect(READ_SCOPE_IDS).toHaveLength(7)
    const { secret } = await seedApiToken({ scopes: [...READ_SCOPE_IDS] })
    for (const entry of writeEntries) {
      const sample = samplePath(entry)
      headersMock.mockResolvedValue(tokenHeaders(secret, entry.id, sample, entry.method))
      const result = await getPrincipal()
      expect(result.ok, entry.id).toBe(false)
      expect(result.rejection, entry.id).toMatchObject({
        status: 403,
        body: { error: 'Route not available to API tokens', route: sample },
      })
    }
  })

  it('task-status opens to any write scope and to no read-only token', async () => {
    const entry = getAllowlistEntryById('task-status')!
    expect(entry.requiredScopes).toEqual(WRITE_SCOPE_IDS)
    const sample = samplePath(entry)
    const readOnly = await seedApiToken({ scopes: [...READ_SCOPE_IDS] })
    headersMock.mockResolvedValue(tokenHeaders(readOnly.secret, entry.id, sample, 'GET'))
    expect((await getPrincipal()).rejection).toMatchObject({ status: 403 })
    for (const scope of WRITE_SCOPE_IDS) {
      const writer = await seedApiToken({ scopes: [scope] })
      headersMock.mockResolvedValue(tokenHeaders(writer.secret, entry.id, sample, 'GET'))
      expect((await getPrincipal()).ok, scope).toBe(true)
    }
  })
})
