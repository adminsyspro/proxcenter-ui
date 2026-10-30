/**
 * Per-domain demo mocks, consulted by lookupMock() after EXTRA_MOCKS and
 * mock-data.json, and before the silent `{ data: [] }` fallback.
 *
 * Each domain module exports:
 *  - a static map keyed `METHOD:/api/v1/...`, on the canonical demo ids
 *    (connection demo-pve-cluster-001, node pve-node-01, PBS demo-pbs-001),
 *    since lookupMock retries with those ids;
 *  - optionally a resolver for paths that carry an id the map cannot list, or
 *    that depend on the query string. It gets the path without query and the
 *    full URL, and returns null when it does not handle the path.
 *
 * A key must not also exist in EXTRA_MOCKS or mock-data.json: those are read
 * first and would mask it (the test in __tests__/domain-mocks.test.ts checks).
 */

import { BACKUP_MOCKS, resolveBackupMock } from './backups'
import { CHANGES_MOCKS, resolveChangesMock } from './changes'
import { INVENTORY_MOCKS, resolveInventoryMock } from './inventory'
import { NODES_MOCKS, resolveNodesMock } from './nodes'
import { OPERATIONS_MOCKS, resolveOperationsMock } from './operations'
import { PBS_MOCKS, resolvePbsMock } from './pbs'
import { SETTINGS_MOCKS, resolveSettingsMock } from './settings'

export type DemoMockMap = Record<string, any>
export type DemoMockResolver = (method: string, cleanPath: string, url: URL) => any | null

export const DOMAIN_MOCKS: DemoMockMap[] = [BACKUP_MOCKS, CHANGES_MOCKS, INVENTORY_MOCKS, NODES_MOCKS, OPERATIONS_MOCKS, PBS_MOCKS, SETTINGS_MOCKS]
export const DOMAIN_RESOLVERS: DemoMockResolver[] = [resolveBackupMock, resolveChangesMock, resolveInventoryMock, resolveNodesMock, resolveOperationsMock, resolvePbsMock, resolveSettingsMock]

export function domainMock(methodKey: string): any {
  for (const map of DOMAIN_MOCKS) {
    if (map[methodKey] !== undefined) return map[methodKey]
  }

  return undefined
}

export function resolveDomainMock(method: string, cleanPath: string, url: URL): any | null {
  for (const resolve of DOMAIN_RESOLVERS) {
    const res = resolve(method, cleanPath, url)

    if (res !== null && res !== undefined) return res
  }

  return null
}
