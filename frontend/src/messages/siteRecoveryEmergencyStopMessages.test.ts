/**
 * The Emergency DR tab gained a per-VM stop action, a replica state column and
 * a restore point picker on its start action, and moved the failback button to
 * the plan header (issues #943 and #944). Every string those controls render
 * must exist in the 6 served locales, or the panic screen falls back to raw key
 * paths in the middle of a disaster.
 */

import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'siteRecovery.emergencyDR.stopVM',
  'siteRecovery.emergencyDR.stopVMTitle',
  'siteRecovery.emergencyDR.stopVMBody',
  'siteRecovery.emergencyDR.resumeReplication',
  'siteRecovery.emergencyDR.resumeReplicationWarning',
  'siteRecovery.emergencyDR.vmStopped',
  'siteRecovery.emergencyDR.planFailback',
  'siteRecovery.emergencyDR.openPlanFailback',
  'siteRecovery.emergencyDR.planFailbackDisabled',
  'siteRecovery.emergencyDR.replicaState',
  'siteRecovery.emergencyDR.replicaStarted',
  'siteRecovery.emergencyDR.replicaStopped',
  'siteRecovery.emergencyDR.replicaStartedHint',
  'siteRecovery.emergencyDR.startVMTitle',
  'siteRecovery.emergencyDR.startVMBody',
  'siteRecovery.emergencyDR.startPausesJob',
  'siteRecovery.emergencyDR.restorePointKeepsNewer',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('Emergency DR per-VM stop i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every Emergency DR stop and plan-failback key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} no longer declares the per-row failback strings the plan header replaced`, () => {
      expect(get(messages, 'siteRecovery.emergencyDR.failback')).toBeUndefined()
      expect(get(messages, 'siteRecovery.emergencyDR.failbackNoPlan')).toBeUndefined()
    })
  }
})
