import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

const importDiskAssetsMock = vi.fn()

vi.mock('@/lib/branding/importDiskAssets', () => ({
  importDiskAssets: importDiskAssetsMock,
}))

const { register } = await import('./instrumentation')

describe('instrumentation register (startup disk-asset import)', () => {
  beforeEach(() => {
    importDiskAssetsMock.mockReset()
    vi.unstubAllEnvs()
  })

  it('imports disk assets from <cwd>/data/uploads on the nodejs runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    importDiskAssetsMock.mockResolvedValue({ imported: 2, skipped: 1 })
    await register()
    expect(importDiskAssetsMock).toHaveBeenCalledTimes(1)
    const root: string = importDiskAssetsMock.mock.calls[0][0]
    expect(root.endsWith(path.join('data', 'uploads'))).toBe(true)
  })

  it('does nothing on the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    await register()
    expect(importDiskAssetsMock).not.toHaveBeenCalled()
  })

  it('does nothing in demo mode (no DB behind the demo image)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('DEMO_MODE', 'true')
    await register()
    expect(importDiskAssetsMock).not.toHaveBeenCalled()
  })

  it('never throws when the import fails (boot must not depend on it)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    importDiskAssetsMock.mockRejectedValue(new Error('db down'))
    await expect(register()).resolves.toBeUndefined()
  })
})
