import { prisma } from '@/lib/db/prisma'

import type { VdcGpuEntry } from './vdcQuota'

const MODEL_KEY = /^0x[0-9a-f]{4}:0x[0-9a-f]{4}$/
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/
const MAX_LINES = 32
const MAX_COUNT = 64
const MAX_MODEL_NAME = 120

type EntryInput = Omit<VdcGpuEntry, 'id'>

function parseLine(raw: unknown): EntryInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind !== 'vgpu' && r.kind !== 'whole') return null
  if (typeof r.modelKey !== 'string' || !MODEL_KEY.test(r.modelKey)) return null
  if (typeof r.modelName !== 'string') return null
  const modelName = r.modelName.trim()
  if (modelName.length < 1 || modelName.length > MAX_MODEL_NAME) return null
  if (typeof r.profileName !== 'string') return null
  if (r.kind === 'whole' ? r.profileName !== '' : !PROFILE_NAME.test(r.profileName)) return null
  if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1 || r.count > MAX_COUNT) return null
  return { kind: r.kind, modelKey: r.modelKey, modelName, profileName: r.profileName, count: r.count }
}

/** Validates a whole contingent: any invalid or duplicated line rejects everything. */
export function parseEntries(raw: unknown): { ok: true; entries: EntryInput[] } | { ok: false } {
  if (!Array.isArray(raw) || raw.length > MAX_LINES) return { ok: false }
  const entries: EntryInput[] = []
  const seen = new Set<string>()
  for (const line of raw) {
    const e = parseLine(line)
    if (!e) return { ok: false }
    const key = `${e.kind}|${e.modelKey}|${e.profileName}`
    if (seen.has(key)) return { ok: false }
    seen.add(key)
    entries.push(e)
  }
  return { ok: true, entries }
}

export async function listVdcGpuEntries(vdcId: string): Promise<VdcGpuEntry[]> {
  const rows = await prisma.vdcGpuQuota.findMany({
    where: { vdcId },
    orderBy: [{ kind: 'asc' }, { modelKey: 'asc' }, { profileName: 'asc' }],
  })
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as VdcGpuEntry['kind'],
    modelKey: r.modelKey,
    modelName: r.modelName,
    profileName: r.profileName,
    count: r.count,
  }))
}

/** Replaces the whole contingent of a vDC in one transaction. */
export async function replaceVdcGpuEntries(vdcId: string, entries: EntryInput[]): Promise<VdcGpuEntry[]> {
  await prisma.$transaction([
    prisma.vdcGpuQuota.deleteMany({ where: { vdcId } }),
    prisma.vdcGpuQuota.createMany({ data: entries.map((e) => ({ ...e, vdcId })) }),
  ])
  return listVdcGpuEntries(vdcId)
}
