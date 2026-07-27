import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { importDiskAssets } from './importDiskAssets'
import { getAsset, putAsset } from './assetStore'

let root = ''
beforeEach(async () => {
  await truncate(['uploaded_assets'])
  root = mkdtempSync(path.join(tmpdir(), 'pcx-uploads-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('importDiskAssets', () => {
  it('imports branding + login-bg files keyed by tenant/slot', async () => {
    mkdirSync(path.join(root, 'branding', 'default'), { recursive: true })
    writeFileSync(path.join(root, 'branding', 'default', 'logo.png'), Buffer.from([1, 2]))
    mkdirSync(path.join(root, 'login-bg', 'tenant-x'), { recursive: true })
    writeFileSync(path.join(root, 'login-bg', 'tenant-x', 'background.jpg'), Buffer.from([3]))

    const res = await importDiskAssets(root)
    expect(res.imported).toBe(2)

    const logo = await getAsset('default', 'branding', 'logo')
    expect(logo!.contentType).toBe('image/png')
    expect(Buffer.from(logo!.data).equals(Buffer.from([1, 2]))).toBe(true)
    const bg = await getAsset('tenant-x', 'login-bg', 'background')
    expect(bg!.ext).toBe('jpg')
  })

  it('is idempotent (second run inserts nothing and skips the existing row)', async () => {
    mkdirSync(path.join(root, 'branding', 'default'), { recursive: true })
    writeFileSync(path.join(root, 'branding', 'default', 'logo.png'), Buffer.from([1]))
    const first = await importDiskAssets(root)
    expect(first).toEqual({ imported: 1, skipped: 0 })
    const second = await importDiskAssets(root)
    expect(second).toEqual({ imported: 0, skipped: 1 })
    const count = await prismaTest.uploadedAsset.count()
    expect(count).toBe(1)
  })

  it('never overwrites an asset that already exists in the database', async () => {
    mkdirSync(path.join(root, 'branding', 'default'), { recursive: true })
    writeFileSync(path.join(root, 'branding', 'default', 'logo.png'), Buffer.from([9, 9]))
    // The DB row is NEWER than the disk file (uploaded via the UI after the
    // legacy file was written): a boot must not clobber it.
    await putAsset('default', 'branding', 'logo', 'png', 'image/png', Buffer.from([1]))
    const res = await importDiskAssets(root)
    expect(res).toEqual({ imported: 0, skipped: 1 })
    const kept = await getAsset('default', 'branding', 'logo')
    expect(Buffer.from(kept!.data).equals(Buffer.from([1]))).toBe(true)
  })

  it('returns zero counts when the root does not exist', async () => {
    const res = await importDiskAssets(path.join(root, 'does-not-exist'))
    expect(res).toEqual({ imported: 0, skipped: 0 })
  })
})
