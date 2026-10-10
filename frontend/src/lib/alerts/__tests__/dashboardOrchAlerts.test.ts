import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAlerts } = vi.hoisted(() => ({ getAlerts: vi.fn() }))

vi.mock('@/lib/orchestrator/client', () => ({ alertsApi: { getAlerts } }))

import { fetchDashboardOrchAlerts } from '@/lib/alerts/dashboardOrchAlerts'

const cpu = { connection_id: 'conn-1', type: 'cpu', resource: 'pve-1', status: 'active' }
const ram = { connection_id: 'conn-2', type: 'memory', resource: 'pve-2', status: 'acknowledged' }

describe('fetchDashboardOrchAlerts', () => {
  beforeEach(() => {
    getAlerts.mockReset()
  })

  it('fetches the active and the acknowledged alerts', async () => {
    getAlerts.mockImplementation(async ({ status }: { status: string }) => ({
      data: { data: status === 'active' ? [cpu] : [ram] },
    }))

    expect(await fetchDashboardOrchAlerts()).toEqual({ active: [cpu], acknowledged: [ram] })
    expect(getAlerts).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', offset: 0 }))
    expect(getAlerts).toHaveBeenCalledWith(expect.objectContaining({ status: 'acknowledged', offset: 0 }))
  })

  it('accepts a bare array and an empty payload', async () => {
    getAlerts.mockImplementation(async ({ status }: { status: string }) => ({
      data: status === 'active' ? [cpu] : undefined,
    }))

    expect(await fetchDashboardOrchAlerts()).toEqual({ active: [cpu], acknowledged: [] })
  })

  it('applies the RBAC gate to both lists', async () => {
    const ackedCpu = { ...cpu, status: 'acknowledged' }
    getAlerts.mockImplementation(async ({ status }: { status: string }) => ({
      data: { data: status === 'active' ? [cpu, { ...ram, status: 'active' }] : [ackedCpu, ram] },
    }))

    const result = await fetchDashboardOrchAlerts(a => a.connection_id === 'conn-1')

    expect(result).toEqual({ active: [cpu], acknowledged: [ackedCpu] })
  })

  it('yields nothing when the orchestrator fails', async () => {
    getAlerts.mockRejectedValue(new Error('ECONNREFUSED'))

    expect(await fetchDashboardOrchAlerts()).toEqual({})
  })
})
