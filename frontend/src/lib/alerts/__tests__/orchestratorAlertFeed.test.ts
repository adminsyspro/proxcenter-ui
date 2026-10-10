import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAlerts } = vi.hoisted(() => ({ getAlerts: vi.fn() }))

vi.mock('@/lib/orchestrator/client', () => ({ alertsApi: { getAlerts } }))

import {
  dedupeOrchestratorAlerts,
  fetchOrchestratorAlerts,
  fetchOrchestratorAlertsByStatus,
} from '@/lib/alerts/orchestratorAlertFeed'

// Stand-in for the orchestrator: rows of every status sorted by last_seen_at
// DESC, filtered and paged like the Go handler.
function orchestratorWith(rows: { id: string; status: string; last_seen_at: string }[]) {
  const sorted = [...rows].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))

  getAlerts.mockImplementation(async ({ status, limit, offset = 0 }: { status?: string; limit: number; offset?: number }) => {
    const matching = status ? sorted.filter(r => r.status === status) : sorted

    return { data: { data: matching.slice(offset, offset + limit), total: matching.length, limit, offset } }
  })
}

function at(day: number, second = 0) {
  return new Date(Date.UTC(2026, 9, day, 0, 0, second)).toISOString()
}

describe('fetchOrchestratorAlertsByStatus', () => {
  beforeEach(() => {
    getAlerts.mockReset()
  })

  it('returns old active alerts buried under newer resolved history (#1086)', async () => {
    orchestratorWith([
      ...Array.from({ length: 1200 }, (_, i) => ({ id: `r${i}`, status: 'resolved', last_seen_at: at(9, i % 60) })),
      ...Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, status: 'active', last_seen_at: at(1) })),
    ])

    const active = await fetchOrchestratorAlertsByStatus('active')

    expect(active).toHaveLength(13)
    expect(getAlerts).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('pages until the orchestrator total is reached', async () => {
    orchestratorWith(Array.from({ length: 1234 }, (_, i) => ({ id: `a${i}`, status: 'active', last_seen_at: at(1, i % 60) })))

    const active = await fetchOrchestratorAlertsByStatus('active')

    expect(active).toHaveLength(1234)
    expect(getAlerts).toHaveBeenCalledTimes(3)
    expect(getAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1000, limit: 500 }))
  })

  it('keeps only the most recent resolved history', async () => {
    orchestratorWith(Array.from({ length: 1500 }, (_, i) => ({ id: `r${i}`, status: 'resolved', last_seen_at: at(1, i % 60) })))

    expect(await fetchOrchestratorAlertsByStatus('resolved')).toHaveLength(1000)
  })

  it('drops rows of another status', async () => {
    getAlerts.mockResolvedValue({ data: { data: [{ id: 'a', status: 'active' }, { id: 'r', status: 'resolved' }] } })

    expect(await fetchOrchestratorAlertsByStatus('active')).toEqual([{ id: 'a', status: 'active' }])
  })
})

describe('fetchOrchestratorAlerts', () => {
  it('fetches each status on its own', async () => {
    getAlerts.mockReset()
    orchestratorWith([
      { id: 'a', status: 'active', last_seen_at: at(1) },
      { id: 'k', status: 'acknowledged', last_seen_at: at(2) },
      { id: 'r', status: 'resolved', last_seen_at: at(3) },
    ])

    const ids = (await fetchOrchestratorAlerts()).map(a => a.id).sort()

    expect(ids).toEqual(['a', 'k', 'r'])
    expect(getAlerts).toHaveBeenCalledTimes(3)
  })
})

describe('dedupeOrchestratorAlerts', () => {
  const fp = (a: { fp: string }) => a.fp
  const status = (a: { status: string }) => a.status

  it('keeps the most recent row per fingerprint', () => {
    const rows = [
      { fp: 'x', status: 'active', last_seen_at: at(1) },
      { fp: 'x', status: 'active', last_seen_at: at(2) },
    ]

    expect(dedupeOrchestratorAlerts(rows, fp, status)).toEqual([rows[1]])
  })

  it('never lets a newer resolved occurrence hide an active alert', () => {
    const rows = [
      { fp: 'x', status: 'active', last_seen_at: at(1) },
      { fp: 'x', status: 'resolved', last_seen_at: at(2) },
    ]

    expect(dedupeOrchestratorAlerts(rows, fp, status)).toHaveLength(2)
  })
})
