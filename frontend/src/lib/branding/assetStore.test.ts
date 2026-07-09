import { describe, it, expect, beforeEach } from 'vitest'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { putAsset, getAsset, deleteAsset, slotFromFilename } from './assetStore'

// The helper uses the app prisma client (@/lib/db/prisma); in tests both that
// client and prismaTest point at the same per-run schema via .test-dsn.
beforeEach(() => truncate(['uploaded_assets']))

describe('assetStore', () => {
  it('putAsset then getAsset round-trips bytes, ext and contentType', async () => {
    await putAsset('default', 'branding', 'logo', 'png', 'image/png', Buffer.from([1, 2, 3]))
    const got = await getAsset('default', 'branding', 'logo')
    expect(got).not.toBeNull()
    expect(got!.ext).toBe('png')
    expect(got!.contentType).toBe('image/png')
    expect(Buffer.from(got!.data).equals(Buffer.from([1, 2, 3]))).toBe(true)
  })

  it('putAsset upserts (second write for same slot replaces the first)', async () => {
    await putAsset('default', 'branding', 'logo', 'png', 'image/png', Buffer.from([1]))
    await putAsset('default', 'branding', 'logo', 'svg', 'image/svg+xml', Buffer.from([9, 9]))
    const got = await getAsset('default', 'branding', 'logo')
    expect(got!.ext).toBe('svg')
    expect(Buffer.from(got!.data).equals(Buffer.from([9, 9]))).toBe(true)
    const count = await prismaTest.uploadedAsset.count({ where: { tenantId: 'default', kind: 'branding', slot: 'logo' } })
    expect(count).toBe(1)
  })

  it('getAsset is scoped by tenant', async () => {
    await putAsset('default', 'branding', 'logo', 'png', 'image/png', Buffer.from([1]))
    expect(await getAsset('tenant-x', 'branding', 'logo')).toBeNull()
  })

  it('deleteAsset removes the row and is a no-op when absent', async () => {
    await putAsset('default', 'login-bg', 'background', 'jpg', 'image/jpeg', Buffer.from([7]))
    await deleteAsset('default', 'login-bg', 'background')
    expect(await getAsset('default', 'login-bg', 'background')).toBeNull()
    await expect(deleteAsset('default', 'login-bg', 'background')).resolves.toBeUndefined()
  })

  it('slotFromFilename strips extension and path segments', () => {
    expect(slotFromFilename('logo.png')).toBe('logo')
    expect(slotFromFilename('background.jpeg')).toBe('background')
    expect(slotFromFilename('../../etc/loginLogo.svg')).toBe('loginLogo')
  })
})
