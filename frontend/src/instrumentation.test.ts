import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { Agent, getGlobalDispatcher } from 'undici'

const importDiskAssetsMock = vi.fn()
const sweepMock = vi.fn()

vi.mock('@/lib/branding/importDiskAssets', () => ({
  importDiskAssets: importDiskAssetsMock,
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/migration/orphan-sweep', () => ({
  sweepOrphanedMigrationJobs: sweepMock,
  resolveInstanceId: () => 'node-a',
}))

const { register } = await import('./instrumentation')

describe('instrumentation register (startup disk-asset import)', () => {
  beforeEach(() => {
    importDiskAssetsMock.mockReset()
    sweepMock.mockReset()
    sweepMock.mockResolvedValue({ owned: 0, foreign: 0, total: 0 })
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

  it('pins the undici global dispatcher to HTTP/1.1 (undici 8 defaults to h2)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    await register()
    const dispatcher = getGlobalDispatcher()
    expect(dispatcher).toBeInstanceOf(Agent)
    const options = Object.getOwnPropertySymbols(dispatcher).find((s) => s.description === 'options')!
    expect((dispatcher as any)[options].allowH2).toBe(false)
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

// #608: a migration runs in an unsupervised after() continuation, so the only
// moment we can be sure a job of ours is dead is our own boot.
describe('instrumentation register (orphaned migration sweep)', () => {
  beforeEach(() => {
    importDiskAssetsMock.mockReset()
    importDiskAssetsMock.mockResolvedValue({ imported: 0, skipped: 0 })
    sweepMock.mockReset()
    sweepMock.mockResolvedValue({ owned: 0, foreign: 0, total: 0 })
    vi.unstubAllEnvs()
  })

  it('sweeps orphaned migration jobs under this instance identity', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    sweepMock.mockResolvedValue({ owned: 1, foreign: 2, total: 3 })
    await register()
    expect(sweepMock).toHaveBeenCalledTimes(1)
    expect(sweepMock.mock.calls[0][0]).toMatchObject({ instanceId: 'node-a' })
  })

  it('never throws when the sweep fails (boot must not depend on it)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    sweepMock.mockRejectedValue(new Error('db down'))
    await expect(register()).resolves.toBeUndefined()
  })

  it('does not sweep on the edge runtime or in demo mode', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    await register()
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('DEMO_MODE', 'true')
    await register()
    expect(sweepMock).not.toHaveBeenCalled()
  })
})
