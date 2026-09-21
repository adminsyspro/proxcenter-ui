import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { getSetting, getSettingWithSource, setSetting } from './settings'

beforeEach(() => truncate(['settings']))

describe('setting ownership', () => {
  it('returns the tenant override and preserves the existing value-only API', async () => {
    await setSetting('branding', 'default', { enabled: true, appName: 'Provider' })
    await setSetting('branding', 'tenant-a', { enabled: false })
    expect(await getSettingWithSource('branding', 'tenant-a')).toEqual({ tenantId: 'tenant-a', value: { enabled: false } })
    expect(await getSetting('branding', 'tenant-a')).toEqual({ enabled: false })
  })

  it('identifies the provider source only when the tenant setting row is absent', async () => {
    await setSetting('branding', 'default', { appName: 'Provider' })
    expect(await getSettingWithSource('branding', 'tenant-a')).toEqual({ tenantId: 'default', value: { appName: 'Provider' } })
    expect(await getSettingWithSource('branding', 'default')).toEqual({ tenantId: 'default', value: { appName: 'Provider' } })
  })

  it('treats a null override as owned by the tenant instead of inheriting provider assets', async () => {
    await setSetting('branding', 'default', { appName: 'Provider' })
    await prismaTest.setting.create({ data: { key: 'branding', tenantId: 'tenant-a', value: Prisma.JsonNull } })
    expect(await getSettingWithSource('branding', 'tenant-a')).toEqual({ tenantId: 'tenant-a', value: null })
  })

  it('returns null when neither tenant nor provider has the setting', async () => {
    expect(await getSettingWithSource('branding', 'tenant-a')).toBeNull()
    expect(await getSetting('branding', 'tenant-a')).toBeNull()
  })
})
