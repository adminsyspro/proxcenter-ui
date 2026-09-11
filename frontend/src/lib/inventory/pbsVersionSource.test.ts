import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * SOURCE-LEVEL on purpose, and the reason is the bug it guards (#925).
 *
 * `fetchRawInventory` read the PBS version as `status.info.version`, from the
 * `/status` payload, which carries no version at all. The expression is typed
 * `any`, so it compiled, never threw, and quietly produced `undefined` for
 * every PBS server on every install: a blank version in the inventory tree,
 * and `proxcenter_pbs_info` absent from the Prometheus exposition. Measured
 * against the lab PBS on 2026-09-11: `/version` answers `{ version: "4.2" }`
 * and `/status` answers no version, so the field had ALWAYS been dead.
 *
 * No fixture-based test catches that class of bug: a mock returning
 * `{info: {version}}` makes the wrong path pass, and a mock returning the
 * real `/status` shape makes it fail for the wrong reason. The failure is in
 * WHICH endpoint is asked and WHICH field is read, so that is what this
 * asserts. The same reasoning already governs `lib/metrics/integrations.test.ts`.
 */
const SOURCE = readFileSync('src/lib/inventory/fetchRawInventory.ts', 'utf8')

describe('PBS version source', () => {
  it("asks PBS's /version endpoint", () => {
    expect(SOURCE).toContain("pbsFetch<any>(connConfig, '/version')")
  })

  it('reads the version off that response, not off /status', () => {
    expect(SOURCE).toContain('version: versionInfo?.version')
    expect(SOURCE).not.toContain('status?.info?.version')
  })

  /**
   * `Promise.allSettled` swallowed the rejection, which is the other half of
   * why this stayed invisible: a PBS that refuses /version looked exactly
   * like a PBS that has no version.
   */
  it('says why the version is missing when the call is rejected', () => {
    expect(SOURCE).toContain("versionResult.status === 'rejected'")
    expect(SOURCE).toMatch(/console\.warn\([^)]*\/version failed/)
  })
})
