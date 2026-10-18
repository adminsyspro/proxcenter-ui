import { describe, expect, it } from 'vitest'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

import { isNodeReachable, nodeStatusMeta } from './nodeStatusMeta'

describe('nodeStatusMeta', () => {
  it('shows a node in HA maintenance as up, in orange, not offline', () => {
    expect(nodeStatusMeta('maintenance')).toMatchObject({ label: 'updates.maintenance', chipColor: 'warning', dot: 'warning.main' })
  })

  it('keeps online green and anything else offline red', () => {
    expect(nodeStatusMeta('online')).toMatchObject({ label: 'updates.online', dot: 'success.main' })
    expect(nodeStatusMeta('offline')).toMatchObject({ label: 'updates.offline', dot: 'error.main' })
    expect(nodeStatusMeta(undefined).label).toBe('updates.offline')
  })

  it('reads the updates of a node in maintenance, not of an offline one', () => {
    expect(isNodeReachable('online')).toBe(true)
    expect(isNodeReachable('maintenance')).toBe(true)
    expect(isNodeReachable('offline')).toBe(false)
  })

  it('every served locale names the three states', () => {
    for (const [locale, messages] of Object.entries({ en, fr, de, es, ko, 'zh-CN': zhCN })) {
      for (const key of ['online', 'maintenance', 'offline']) {
        expect((messages as any).updates?.[key], `${locale}: updates.${key}`).toBeTypeOf('string')
      }
    }
  })
})
