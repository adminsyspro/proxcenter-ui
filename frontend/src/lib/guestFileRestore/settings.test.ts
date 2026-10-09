import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(), setSettingMock: vi.fn() }))

vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: any[]) => getSettingMock(...a),
  setSetting: (...a: any[]) => setSettingMock(...a),
}))

import {
  DEFAULT_GUEST_FILE_RESTORE_SETTINGS,
  GUEST_FILE_RESTORE_SETTING_KEY,
  guestFileRestoreSettingsSchema,
  loadGuestFileRestoreSettings,
  parseGuestFileRestoreSettings,
  saveGuestFileRestoreSettings,
} from './settings'

beforeEach(() => {
  getSettingMock.mockReset()
  setSettingMock.mockReset().mockResolvedValue(undefined)
})

describe('guest file restore settings', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_GUEST_FILE_RESTORE_SETTINGS).toEqual({
      agentEnabled: true,
      sshEnabled: true,
      agentMaxBytes: 1024 * 1024 * 1024,
      agentParallelWrites: 4,
      defaultConflict: 'keep',
      restoredPrefix: 'RESTORED-',
      defaultCustomDirLinux: '/var/tmp/proxcenter-restore',
      defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
      sshConnectTimeoutSec: 20,
      maxConcurrentJobs: 3,
      jobRetentionDays: 30,
      spoolDir: '',
      spoolMinFreeBytes: 2 * 1024 * 1024 * 1024,
      sourceStallTimeoutSec: 120,
    })
  })

  it('accepts an empty or absolute spool dir only', () => {
    expect(guestFileRestoreSettingsSchema.safeParse({ spoolDir: '/var/spool/pxc' }).success).toBe(true)
    expect(guestFileRestoreSettingsSchema.safeParse({ spoolDir: '  ' }).success).toBe(true)
    expect(guestFileRestoreSettingsSchema.safeParse({ spoolDir: 'relative/dir' }).success).toBe(false)
    expect(guestFileRestoreSettingsSchema.safeParse({ sourceStallTimeoutSec: 5 }).success).toBe(false)
    expect(guestFileRestoreSettingsSchema.safeParse({ spoolMinFreeBytes: -1 }).success).toBe(false)
  })

  it('fills a partial row with the defaults and falls back on a corrupt one', () => {
    expect(parseGuestFileRestoreSettings({ sshEnabled: false })).toEqual({ ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS, sshEnabled: false })
    expect(parseGuestFileRestoreSettings('garbage')).toEqual(DEFAULT_GUEST_FILE_RESTORE_SETTINGS)
    expect(parseGuestFileRestoreSettings({ maxConcurrentJobs: 999 })).toEqual(DEFAULT_GUEST_FILE_RESTORE_SETTINGS)
    expect(parseGuestFileRestoreSettings(null)).toEqual(DEFAULT_GUEST_FILE_RESTORE_SETTINGS)
  })

  it('enforces the bounds and path shapes', () => {
    const ok = (over: object) => guestFileRestoreSettingsSchema.safeParse(over).success
    expect(ok({ agentMaxBytes: 1024 })).toBe(false)
    expect(ok({ agentMaxBytes: 65 * 1024 * 1024 * 1024 })).toBe(false)
    expect(ok({ restoredPrefix: 'a/b' })).toBe(false)
    expect(ok({ restoredPrefix: '' })).toBe(false)
    expect(ok({ restoredPrefix: 'copy_' })).toBe(true)
    expect(ok({ defaultCustomDirLinux: 'relative/dir' })).toBe(false)
    expect(ok({ defaultCustomDirWindows: '/not/windows' })).toBe(false)
    expect(ok({ defaultCustomDirWindows: 'D:/Restore' })).toBe(true)
    expect(ok({ sshConnectTimeoutSec: 4 })).toBe(false)
    expect(ok({ jobRetentionDays: 0 })).toBe(false)
    expect(ok({ defaultConflict: 'rename' })).toBe(false)
  })

  it('loads from the provider tenant row', async () => {
    getSettingMock.mockResolvedValue({ agentEnabled: false })
    await expect(loadGuestFileRestoreSettings()).resolves.toMatchObject({ agentEnabled: false, sshEnabled: true })
    expect(getSettingMock).toHaveBeenCalledWith(GUEST_FILE_RESTORE_SETTING_KEY, 'default')
  })

  it('validates then persists on save', async () => {
    const saved = await saveGuestFileRestoreSettings({ ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS, maxConcurrentJobs: 5 })
    expect(saved.maxConcurrentJobs).toBe(5)
    expect(setSettingMock).toHaveBeenCalledWith(GUEST_FILE_RESTORE_SETTING_KEY, 'default', saved)
    await expect(saveGuestFileRestoreSettings({ maxConcurrentJobs: 0 })).rejects.toThrow()
  })
})
