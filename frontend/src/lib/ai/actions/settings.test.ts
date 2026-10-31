import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(), setSettingMock: vi.fn() }))

vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: any[]) => getSettingMock(...a),
  setSetting: (...a: any[]) => setSettingMock(...a),
}))

import { ACTION_KINDS, ACTION_TIER, enabledKinds, normalizeAiActionsSettings } from './types'
import { getAiActionsSettings, saveAiActionsSettings } from './settings'
import { EDITION_FEATURES, Features } from '@/lib/license/features'

beforeEach(() => {
  vi.clearAllMocks()
  setSettingMock.mockResolvedValue(undefined)
})

describe('normalizeAiActionsSettings', () => {
  it('defaults everything to off with a cap of 5', () => {
    for (const raw of [undefined, null, 'x', 42, []]) {
      const s = normalizeAiActionsSettings(raw)
      expect(s.enabled).toBe(false)
      expect(s.maxPerConversation).toBe(5)
      expect(Object.keys(s.actions)).toEqual([...ACTION_KINDS])
      expect(Object.values(s.actions).every(v => v === false)).toBe(true)
    }
  })

  it('ignores unknown kinds and non-boolean values', () => {
    const s = normalizeAiActionsSettings({ enabled: true, actions: { snapshot: true, delete_vm: true, start: 'yes' } })
    expect(s.enabled).toBe(true)
    expect(s.actions.snapshot).toBe(true)
    expect(s.actions.start).toBe(false)
    expect((s.actions as Record<string, boolean>).delete_vm).toBeUndefined()
  })

  it('clamps maxPerConversation to 1..20', () => {
    expect(normalizeAiActionsSettings({ maxPerConversation: 0 }).maxPerConversation).toBe(1)
    expect(normalizeAiActionsSettings({ maxPerConversation: 99 }).maxPerConversation).toBe(20)
    expect(normalizeAiActionsSettings({ maxPerConversation: 7.9 }).maxPerConversation).toBe(7)
    expect(normalizeAiActionsSettings({ maxPerConversation: 'abc' }).maxPerConversation).toBe(5)
  })
})

describe('tiers and enabledKinds', () => {
  it('classifies the three disruptive kinds', () => {
    expect(ACTION_KINDS.filter(k => ACTION_TIER[k] === 'disruptive')).toEqual(['shutdown', 'reboot', 'maintenance'])
  })

  it('is empty when the master switch is off', () => {
    const s = normalizeAiActionsSettings({ enabled: false, actions: { snapshot: true } })
    expect(enabledKinds(s)).toEqual([])
  })

  it('returns enabled kinds in ACTION_KINDS order', () => {
    const s = normalizeAiActionsSettings({ enabled: true, actions: { reboot: true, snapshot: true } })
    expect(enabledKinds(s)).toEqual(['snapshot', 'reboot'])
  })
})

describe('license features', () => {
  it('grants ai_actions to both enterprise editions, and enterprise_plus covers enterprise', () => {
    expect(Features.AI_ACTIONS).toBe('ai_actions')
    expect(EDITION_FEATURES.enterprise).toContain('ai_actions')
    expect(EDITION_FEATURES.enterprise_plus).toContain('ai_actions')
    for (const f of EDITION_FEATURES.enterprise) expect(EDITION_FEATURES.enterprise_plus).toContain(f)
  })
})

describe('store', () => {
  it('returns defaults when nothing is stored', async () => {
    getSettingMock.mockResolvedValue(null)
    const s = await getAiActionsSettings('t1')
    expect(getSettingMock).toHaveBeenCalledWith('ai_actions', 't1')
    expect(s.enabled).toBe(false)
  })

  it('normalises before saving and returns what was stored', async () => {
    const s = await saveAiActionsSettings('t1', { enabled: true, maxPerConversation: 99, actions: { start: true, bogus: true } })
    expect(setSettingMock).toHaveBeenCalledWith('ai_actions', 't1', s)
    expect(s.maxPerConversation).toBe(20)
    expect(enabledKinds(s)).toEqual(['start'])
  })
})
