import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  findMany: vi.fn(),
  $transaction: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    vdcGpuQuota: { deleteMany: m.deleteMany, createMany: m.createMany, findMany: m.findMany },
    $transaction: m.$transaction,
  },
}))

import { listVdcGpuEntries, parseEntries, replaceVdcGpuEntries } from './vdcEntries'

const vgpu = { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 4 }
const whole = { kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 }

describe('parseEntries', () => {
  it('accepts valid lines and trims modelName', () => {
    const r = parseEntries([vgpu, { ...whole, modelName: '  RTX A5000  ' }])
    expect(r).toEqual({ ok: true, entries: [vgpu, whole] })
  })

  it('accepts an empty list', () => {
    expect(parseEntries([])).toEqual({ ok: true, entries: [] })
  })

  it.each([
    ['non array', {}],
    ['non object line', [1]],
    ['unknown kind', [{ ...vgpu, kind: 'mig' }]],
    ['bad modelKey', [{ ...vgpu, modelKey: '10de:2231' }]],
    ['uppercase modelKey', [{ ...vgpu, modelKey: '0x10DE:0x2231' }]],
    ['profile on whole', [{ ...whole, profileName: 'x' }]],
    ['empty profile on vgpu', [{ ...vgpu, profileName: '' }]],
    ['vendor prefix in profile', [{ ...vgpu, profileName: 'NVIDIA RTXA5000-12Q' }]],
    ['count 0', [{ ...vgpu, count: 0 }]],
    ['count 65', [{ ...vgpu, count: 65 }]],
    ['count 1.5', [{ ...vgpu, count: 1.5 }]],
    ['count string', [{ ...vgpu, count: '4' }]],
    ['duplicate', [vgpu, { ...vgpu, count: 2 }]],
    ['too many lines', Array.from({ length: 33 }, (_, i) => ({ ...vgpu, profileName: `P${i}` }))],
    ['modelName too long', [{ ...vgpu, modelName: 'x'.repeat(121) }]],
    ['empty modelName', [{ ...vgpu, modelName: '   ' }]],
    ['one bad line rejects all', [vgpu, { ...whole, count: 0 }]],
  ])('rejects %s', (_n, raw) => {
    expect(parseEntries(raw)).toEqual({ ok: false })
  })

  it('accepts exactly 32 lines', () => {
    const raw = Array.from({ length: 32 }, (_, i) => ({ ...vgpu, profileName: `P${i}` }))
    expect(parseEntries(raw).ok).toBe(true)
  })
})

describe('store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.deleteMany.mockReturnValue('del')
    m.createMany.mockReturnValue('create')
    m.$transaction.mockResolvedValue([])
    m.findMany.mockResolvedValue([{ id: 'a', vdcId: 'v1', updatedAt: new Date(), ...vgpu }])
  })

  it('lists sorted by kind, modelKey, profileName', async () => {
    const r = await listVdcGpuEntries('v1')
    expect(m.findMany).toHaveBeenCalledWith({
      where: { vdcId: 'v1' },
      orderBy: [{ kind: 'asc' }, { modelKey: 'asc' }, { profileName: 'asc' }],
    })
    expect(r).toEqual([{ id: 'a', ...vgpu }])
  })

  it('replaces in one transaction: delete by vdc then create', async () => {
    await replaceVdcGpuEntries('v1', [vgpu, whole] as any)
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { vdcId: 'v1' } })
    expect(m.createMany).toHaveBeenCalledWith({ data: [vgpu, whole].map((e) => ({ ...e, vdcId: 'v1' })) })
    expect(m.$transaction).toHaveBeenCalledWith(['del', 'create'])
    expect(m.findMany).toHaveBeenCalledTimes(1)
  })
})
