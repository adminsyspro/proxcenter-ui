import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales = { en, fr, de, es, ko, 'zh-CN': zhCN }
const requiredKeys = [
  "subtitle",
  "noCeph",
  "noCephDesc",
  "oneCeph",
  "oneCephDesc",
  "dashboard.noSitesConfigured",
  "dashboard.noSitesDesc",
  "protection.noJobsDesc",
  "protection.deleteOrphansNote",
  "createJob.retentionTargetHelp",
  "preflight.checks.source_health",
  "preflight.checks.target_health",
  "snapshots.clusters",
  "snapshots.noneDesc",
  "createJob.targetStorage",
  "createJob.selectStorage",
  "createJob.targetNode",
  "createJob.zfsNodeHint",
  "createJob.vmMixedStorage",
  "createJob.vmMixedStorageWarn",
  "createJob.vmUnsupportedDisk",
  "createJob.sshChecks",
  "preflight.checks.target_storage",
  "preflight.checks.reverse_ssh",
  "snapshots.engine",
  "snapshots.node",
  "snapshots.partialInventory",
  "engine.rbd",
  "engine.zfs",
  "failover.clonesDestroyed",
  "failover.testActiveConflict",
  "plans.jobColumn",
  "discoveryError",
  "discoveryLoading",
  "createJob.engine",
  "createJob.engineCeph",
  "createJob.engineZfs",
  "createJob.engineComingSoon"
]

function get(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined, messages)
}

describe('Site Recovery ZFS message parity', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares all new, generalized and reused engine keys`, () => {
      for (const key of requiredKeys) {
        const value = get(messages.siteRecovery, key)
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value, `${locale}: ${key}`).not.toBe('')
      }
    })
  }
})
