import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { importDiskAssets } from './importDiskAssets'
import { getAsset } from './assetStore'

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

  it('is idempotent (re-running imports the same rows without duplication)', async () => {
    mkdirSync(path.join(root, 'branding', 'default'), { recursive: true })
    writeFileSync(path.join(root, 'branding', 'default', 'logo.png'), Buffer.from([1]))
    await importDiskAssets(root)
    await importDiskAssets(root)
    const count = await prismaTest.uploadedAsset.count()
    expect(count).toBe(1)
  })

  it('returns zero counts when the root does not exist', async () => {
    const res = await importDiskAssets(path.join(root, 'does-not-exist'))
    expect(res).toEqual({ imported: 0, skipped: 0 })
  })
})
