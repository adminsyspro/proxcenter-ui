import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Test of a waiting warm migration: button, settings dialog, banner, batch chip.
const keys: Array<[string, string[]]> = [
  ['inventoryPage.esxiMigration.testStart', []],
  ['inventoryPage.esxiMigration.testDialogTitle', ['{name}']],
  ['inventoryPage.esxiMigration.testOverlayStorage', []],
  ['inventoryPage.esxiMigration.testStorageOption', ['{storage}', '{free}']],
  ['inventoryPage.esxiMigration.testNetwork', []],
  ['inventoryPage.esxiMigration.testNoNetwork', []],
  ['inventoryPage.esxiMigration.testVlanTag', []],
  ['inventoryPage.esxiMigration.testStopAfter', []],
  ['inventoryPage.esxiMigration.testStopAfterHours', ['{hours}']],
  ['inventoryPage.esxiMigration.testInfo', []],
  ['inventoryPage.esxiMigration.testInfoRam', ['{node}', '{free}']],
  ['inventoryPage.esxiMigration.testBridgeWarning', []],
  ['inventoryPage.esxiMigration.testNoStorage', ['{node}']],
  ['inventoryPage.esxiMigration.testStartAction', []],
  ['inventoryPage.esxiMigration.testRequested', []],
  ['inventoryPage.esxiMigration.testPreparing', ['{step}', '{label}']],
  ['inventoryPage.esxiMigration.testStepChecks', []],
  ['inventoryPage.esxiMigration.testStepConversion', []],
  ['inventoryPage.esxiMigration.testStepOverlay', []],
  ['inventoryPage.esxiMigration.testStepBoot', []],
  ['inventoryPage.esxiMigration.testRunning', ['{size}', '{vmid}']],
  ['inventoryPage.esxiMigration.testStopping', []],
  ['inventoryPage.esxiMigration.testConsole', []],
  ['inventoryPage.esxiMigration.testStop', []],
  ['inventoryPage.esxiMigration.testBlocksCutover', []],
  ['inventoryPage.esxiMigration.testRowLabel', []],
  ['inventoryPage.esxiMigration.cancelMigrationRemoveTarget', ['{vmid}']],
  ['inventoryPage.esxiMigration.cancelMigrationRemoveCopy', []],
]

const lookup = (messages: any, path: string) => path.split('.').reduce((node, part) => node?.[part], messages)

describe('migration test i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, placeholders] of keys) {
      it(`${locale} declares ${key}`, () => {
        const value = lookup(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value.length, `${locale}: ${key} must not be empty`).toBeGreaterThan(0)
        for (const placeholder of placeholders) expect(value, `${locale}: ${key}`).toContain(placeholder)
      })
    }
  }
})
