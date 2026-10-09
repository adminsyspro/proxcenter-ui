// src/lib/connections/check/privilegeMap.test.ts
//
// The map itself: ACL evaluation, the pveum fix, and coverage of every PVE
// endpoint the tree calls through pveFetch.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ENDPOINT_FEATURES,
  FEATURE_IDS,
  PRIVILEGE_REQUIREMENTS,
  aclCommand,
  endpointFamily,
  hasPrivilegeAt,
  splitTokenId,
  tokenIdOf,
} from './privilegeMap'
import { PVE_VERSION_GATES } from './versionGates'

describe('hasPrivilegeAt', () => {
  it('accepts a grant on the exact path whether or not it propagates', () => {
    expect(hasPrivilegeAt({ '/vms': { 'VM.Audit': 0 } }, '/vms', 'VM.Audit')).toBe(true)
    expect(hasPrivilegeAt({ '/vms': { 'VM.Audit': 1 } }, '/vms', 'VM.Audit')).toBe(true)
  })

  it('inherits from the nearest listed ancestor only when it propagates', () => {
    expect(hasPrivilegeAt({ '/': { 'Sys.Audit': 1 } }, '/nodes/pve1', 'Sys.Audit')).toBe(true)
    expect(hasPrivilegeAt({ '/': { 'Sys.Audit': 0 } }, '/nodes', 'Sys.Audit')).toBe(false)
    // The nearest ancestor is authoritative: PVE already folded / into /vms.
    expect(hasPrivilegeAt({ '/': { 'VM.Audit': 1 }, '/vms': { 'VM.Console': 1 } }, '/vms/100', 'VM.Audit')).toBe(false)
  })

  it('denies when nothing is listed on the path or above', () => {
    expect(hasPrivilegeAt({}, '/storage', 'Datastore.Audit')).toBe(false)
    expect(hasPrivilegeAt({ '/storage/local': { 'Datastore.Audit': 1 } }, '/storage', 'Datastore.Audit')).toBe(false)
  })
})

describe('tokenIdOf and aclCommand', () => {
  it('strips the secret from the token', () => {
    expect(tokenIdOf('user@pve!tok=1234')).toBe('user@pve!tok')
    expect(tokenIdOf('user@pve!tok')).toBe('user@pve!tok')
  })

  it('splits a token id into user and name', () => {
    expect(splitTokenId('u@pve!t')).toEqual({ user: 'u@pve', name: 't' })
    expect(splitTokenId('root@pam')).toEqual({ user: 'root@pam', name: null })
  })

  it('grants the user and, unless separation is known off, the token too', () => {
    // Separation on: PVE intersects the user ACL and the token ACL, both need the grant.
    expect(aclCommand('/vms', 'u@pve!t', ['VM.Console'], true)).toBe(
      "pveum aclmod /vms -user u@pve -role PVEAdmin ; pveum aclmod /vms -token 'u@pve!t' -role PVEAdmin",
    )
    // Unknown: write both, the hint says when the second applies.
    expect(aclCommand('/vms', 'u@pve!t', ['VM.Console'], null)).toBe(
      "pveum aclmod /vms -user u@pve -role PVEAdmin ; pveum aclmod /vms -token 'u@pve!t' -role PVEAdmin",
    )
    // Separation off: the token uses the user's privileges, only the user is granted.
    expect(aclCommand('/vms', 'u@pve!t', ['VM.Console'], false)).toBe('pveum aclmod /vms -user u@pve -role PVEAdmin')
  })

  it('creates a custom role when PVEAdmin lacks the privilege', () => {
    expect(aclCommand('/nodes', 'u@pve!t', ['Sys.PowerMgmt'], true)).toBe(
      "pveum role add ProxCenter -privs \"Sys.PowerMgmt\" ; pveum aclmod /nodes -user u@pve -role ProxCenter ; pveum aclmod /nodes -token 'u@pve!t' -role ProxCenter",
    )
  })
})

describe('the map', () => {
  it('names only known features, and every feature is reachable from a requirement or a version gate', () => {
    const known = new Set<string>(FEATURE_IDS)
    const used = new Set<string>()
    for (const req of PRIVILEGE_REQUIREMENTS) {
      expect(req.privileges.length).toBeGreaterThan(0)
      expect(req.features.length).toBeGreaterThan(0)
      for (const f of req.features) {
        expect(known.has(f), `${req.id} names unknown feature ${f}`).toBe(true)
        used.add(f)
      }
    }
    for (const gate of PVE_VERSION_GATES) {
      expect(known.has(gate.feature)).toBe(true)
      used.add(gate.feature)
    }
    for (const [family, features] of Object.entries(ENDPOINT_FEATURES)) {
      for (const f of features) {
        expect(known.has(f), `${family} names unknown feature ${f}`).toBe(true)
        expect(used.has(f), `${family} serves ${f}, which no requirement covers`).toBe(true)
      }
    }
    for (const f of FEATURE_IDS) expect(used.has(f), `feature ${f} is covered by nothing`).toBe(true)
  })

  it('has unique requirement ids', () => {
    const ids = PRIVILEGE_REQUIREMENTS.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('classifies representative endpoints', () => {
    expect(endpointFamily('/nodes/{x}/qemu/{x}/vncproxy')).toBe('guest/console')
    expect(endpointFamily('/nodes/{x}/termproxy')).toBe('node/shell')
    expect(endpointFamily('/nodes/{x}/{x}/{x}/config')).toBe('guest')
    expect(endpointFamily('/nodes/{x}/network/{x}')).toBe('node')
    expect(endpointFamily('/nodes/{x}/status')).toBe('node')
    expect(endpointFamily('/nodes/{x}/qemu/{x}/status/start')).toBe('guest/power')
    expect(endpointFamily('/nodes/{x}/storage/{x}/download-url')).toBe('storage/download')
    expect(endpointFamily('/nodes/{x}/ceph/osd')).toBe('ceph')
    expect(endpointFamily('/cluster/config/join')).toBe('cluster/status')
    expect(endpointFamily('/pools/{x}')).toBe('pools')
    expect(endpointFamily('{x}/{x}')).toBe('dynamic')
    expect(endpointFamily('/something/new')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Coverage: every pveFetch path in the tree belongs to a family of the map.
// ---------------------------------------------------------------------------

const ROOTS = ['src/app/api', 'src/lib']
const SKIP = /(\.test\.[tj]sx?$)|(^src\/lib\/demo\/)|(\/__tests__\/)/

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|js)$/.test(entry)) out.push(full)
  }
}

/** Every literal path handed to pveFetch, holes reduced to {x}, query dropped. */
function pveFetchPaths(): Map<string, string[]> {
  const files: string[] = []
  for (const root of ROOTS) walk(path.resolve(process.cwd(), root), files)
  const found = new Map<string, string[]>()
  const call = /pveFetch(?:<[^>()]*>)?\(\s*[^,()]+,\s*([`'"])([^`'"]*)\1/g
  for (const file of files) {
    const rel = path.relative(process.cwd(), file)
    if (SKIP.test(rel)) continue
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(call)) {
      const p = m[2].replaceAll(/\$\{[^}]*\}/g, '{x}').replace(/\?.*$/, '')
      if (!found.has(p)) found.set(p, [])
      found.get(p)!.push(rel)
    }
  }
  return found
}

describe('privilege map coverage of pveFetch calls', () => {
  it('finds the calls at all', () => {
    expect(pveFetchPaths().size).toBeGreaterThan(50)
  })

  it('classifies every path into a family that the map knows', () => {
    const unknown: string[] = []
    for (const [p, files] of pveFetchPaths()) {
      const family = endpointFamily(p)
      if (!family || !(family in ENDPOINT_FEATURES)) unknown.push(`${p} (${files[0]})`)
    }
    expect(unknown, 'add these endpoints to FAMILY_RULES / ENDPOINT_FEATURES in privilegeMap.ts').toEqual([])
  })
})
