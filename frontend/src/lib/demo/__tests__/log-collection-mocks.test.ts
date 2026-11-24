import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'

const demoGet = async (path: string): Promise<{ status: number; body: any }> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`))

    return { status: res!.status, body: await res!.json() }
  } finally {
    process.env.DEMO_MODE = prev
  }
}

// The Logs tab of a cluster connection reads this route: the demo clusters
// read their firewall logs through the Proxmox API, the default.
describe('demo log collection', () => {
  it.each(['demo-pve-cluster-001', 'demo-pve-dr-001'])('serves the API mode for %s, with what the tab needs to draw itself', async id => {
    const { status, body } = await demoGet(`/api/v1/connections/${id}/log-collection`)

    expect(status).toBe(200)
    expect(body).toMatchObject({ mode: 'api', receiver_port: 6344, queue_mb: 256, budget_lines_per_min: 30000, nodes: [], run: null, busy: false })
    expect(body.limits).toEqual({ min_queue_mb: 16, max_queue_mb: 4096, min_budget: 1000, max_budget: 300000 })
    expect(typeof body.receiver_default).toBe('string')
    expect(typeof body.ssh_enabled).toBe('boolean')
    expect(typeof body.has_policy).toBe('boolean')
  })
})
