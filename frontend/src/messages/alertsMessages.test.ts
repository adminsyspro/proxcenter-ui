import { describe, it, expect } from 'vitest'

import en from './en.json'
import fr from './fr.json'
import de from './de.json'
import zhCN from './zh-CN.json'
import ko from './ko.json'
import es from './es.json'

type Messages = Record<string, unknown>

function keyPaths(obj: Messages, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      out.push(...keyPaths(value as Messages, path))
    } else {
      out.push(path)
    }
  }
  return out.sort()
}

const locales: Array<[string, Messages]> = [
  ['fr', fr as Messages],
  ['de', de as Messages],
  ['zh-CN', zhCN as Messages],
  ['ko', ko as Messages],
  ['es', es as Messages],
]

describe('alerts message namespace', () => {
  const reference = keyPaths((en as Messages).alerts as Messages)

  it('en defines the full alerts key inventory', () => {
    for (const required of [
      'title',
      'thresholdsConfig',
      'resourceUsage',
      'maintenance',
      'detail.title',
      'detail.currentValue',
      'messages.nodeOffline',
      'snapshotAge',
      'snapshotDisabled',
      'recoveryTitle',
      'recoveryMargin',
      'recoveryConfirmations',
      // #721: Ceph OSD latency and replication RPO thresholds.
      'performanceReplication',
      'osdLatency',
      'osdLatencyDesc',
      'osdLatencyWarning',
      'osdLatencyCritical',
      'replicationRpo',
      'replicationRpoDesc',
      'replicationRpoGrace',
    ]) {
      expect(reference).toContain(required)
    }
  })

  for (const [name, messages] of locales) {
    it(`${name} has exactly the same alerts keys as en`, () => {
      expect(messages.alerts, `${name}.json is missing the top-level "alerts" section`).toBeDefined()
      expect(keyPaths(messages.alerts as Messages)).toEqual(reference)
    })
  }
})
