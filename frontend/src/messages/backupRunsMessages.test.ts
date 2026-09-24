import { describe, it, expect } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

type Messages = Record<string, any>

const KEYS = [
  'colLastRun', 'colDuration', 'colStatus', 'colNextRun', 'manualBackups', 'manualBackupsHint', 'never', 'noRuns',
  'drawerTitle', 'runsTitle', 'window', 'unreachable', 'logUnavailable', 'origin.scheduled', 'origin.manual', 'shared',
  'guest', 'node', 'start', 'transferred', 'reused', 'archive', 'rawLog', 'copyLog', 'showProgress', 'jobSection',
  'selectRun', 'loadError', 'status.ok', 'status.warning', 'status.running', 'status.failed', 'status.partial',
  'status.post.prune', 'status.post.protected', 'status.post.hook', 'status.post.other', 'truncated', 'logLoadError',
]

const get = (obj: Messages, path: string) => path.split('.').reduce<any>((o, k) => o?.[k], obj)

const locales: Array<[string, Messages]> = [
  ['en', en], ['fr', fr], ['de', de], ['es', es], ['ko', ko], ['zh-CN', zhCN],
]

describe('backup run history message keys (#1003)', () => {
  for (const [name, messages] of locales) {
    it(`${name} defines every backups.runs key`, () => {
      for (const key of KEYS) expect(get(messages, `backups.runs.${key}`), `${name}.backups.runs.${key}`).toBeTruthy()
    })

    it(`${name} keeps the placeholders`, () => {
      expect(get(messages, 'backups.runs.noRuns')).toContain('{days}')
      expect(get(messages, 'backups.runs.window')).toContain('{days}')
      expect(get(messages, 'backups.runs.drawerTitle')).toContain('{job}')
      expect(get(messages, 'backups.runs.unreachable')).toContain('{nodes}')
      expect(get(messages, 'backups.runs.shared')).toContain('{jobs}')
      expect(get(messages, 'backups.runs.truncated')).toContain('{nodes}')
    })
  }

  // #1003 final review: the window line must not claim older runs were
  // rotated out (the index may simply not go back that far).
  it('words the window as a limit of the task index, not a rotation', () => {
    expect(get(en, 'backups.runs.window')).toBe('Last {days} days, as far as the Proxmox task index goes.')
    expect(get(fr, 'backups.runs.window')).toBe("{days} derniers jours, dans la limite de l'index des tâches Proxmox.")
    expect(get(en, 'backups.runs.logLoadError')).toBe('Could not load the log')
    expect(get(fr, 'backups.runs.logLoadError')).toBe('Impossible de charger le log')
  })
})
