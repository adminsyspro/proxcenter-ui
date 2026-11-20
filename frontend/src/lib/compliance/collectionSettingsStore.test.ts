import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingMock, setSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn(), setSettingMock: vi.fn() }))

vi.mock('@/lib/db/settings', () => ({ getSetting: getSettingMock, setSetting: setSettingMock }))

import { COLLECTION_SETTINGS_KEY, getCollectionSettings, saveCollectionSettings } from './collectionSettingsStore'

beforeEach(() => {
  vi.clearAllMocks()
  setSettingMock.mockResolvedValue(undefined)
})

describe('getCollectionSettings', () => {
  it('reads the tenant row', async () => {
    getSettingMock.mockResolvedValue({ cacheMinutes: 15, guestConcurrency: 2 })

    expect(await getCollectionSettings('t1')).toEqual({ cacheMinutes: 15, guestConcurrency: 2 })
    expect(getSettingMock).toHaveBeenCalledWith(COLLECTION_SETTINGS_KEY, 't1')
  })

  it('never fails: a database error leaves the defaults', async () => {
    getSettingMock.mockRejectedValue(new Error('db down'))

    expect(await getCollectionSettings('t1')).toEqual({ cacheMinutes: 5, guestConcurrency: 4 })
  })
})

describe('saveCollectionSettings', () => {
  it('merges the patch into the stored row', async () => {
    getSettingMock.mockResolvedValue({ cacheMinutes: 15, guestConcurrency: 2 })

    expect(await saveCollectionSettings('t1', { guestConcurrency: 6 })).toEqual({ cacheMinutes: 15, guestConcurrency: 6 })
    expect(setSettingMock).toHaveBeenCalledWith(COLLECTION_SETTINGS_KEY, 't1', { cacheMinutes: 15, guestConcurrency: 6 })
  })

  it('starts from the defaults when nothing is stored', async () => {
    getSettingMock.mockResolvedValue(null)

    expect(await saveCollectionSettings('t1', { cacheMinutes: 0 })).toEqual({ cacheMinutes: 0, guestConcurrency: 4 })
  })
})
