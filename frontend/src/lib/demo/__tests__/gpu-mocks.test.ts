import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'
import { DEMO_GPU_GUESTS } from '../mocks/gpu'

const demoGet = async (path: string): Promise<{ status: number; body: any }> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`))

    return { status: res?.status ?? 0, body: res ? await res.json() : null }
  } finally {
    process.env.DEMO_MODE = prev
  }
}

const PROD = 'demo-pve-cluster-001'
const A40 = `${PROD}:pve-node-03:0000:3b:00`

describe('GPU demo (#672)', () => {
  it('the report holds the cards of the story and their holders, not the list fallback', async () => {
    const { body } = await demoGet('/api/v1/gpu')
    const report = body.data

    expect(Array.isArray(report)).toBe(false)
    expect(report.scope).toBe('infrastructure')
    expect(report.capacity).toEqual({ total: 5, allocated: 4, free: 1, inUse: 3, consoles: 16 })
    expect(report.devices.filter((d: any) => d.kind === 'gpu').map((d: any) => [d.node, d.deviceName])).toEqual([
      ['pve-node-03', 'GA102GL [A40]'],
      ['pve-node-11', 'AD102GL [L40S]'],
      ['pve-node-11', 'AD102GL [L40S]'],
      ['pve-node-12', 'GA100 [A100 PCIe 80GB]'],
      ['pve-node-12', 'AD104GL [L4]'],
    ])
    const a40 = report.devices.find((d: any) => d.key === A40)

    expect(a40.vgpu.mode).toBe('sriov')
    expect(a40.vms.map((v: any) => String(v.vmid)).sort((x: string, y: string) => x.localeCompare(y))).toEqual(['1101', '1102', '200', '249'])
  })

  it('narrows to a node and to a cluster as the inventory tabs ask', async () => {
    const node = (await demoGet(`/api/v1/gpu?connId=${PROD}&node=pve-node-11`)).body.data

    expect(node.devices.filter((d: any) => d.kind === 'gpu')).toHaveLength(2)
    expect(node.devices.every((d: any) => d.node === 'pve-node-11')).toBe(true)

    const dr = (await demoGet('/api/v1/gpu?connId=demo-pve-dr-001')).body.data

    expect(dr.capacity.total).toBe(0)
    expect(dr.capacity.consoles).toBe(4)
  })

  it('every reading belongs to a card, and every running vGPU to its VM', async () => {
    const latest = (await demoGet('/api/v1/gpu/metrics/latest')).body.data

    expect(latest.configured).toBe(true)
    expect(latest.gpus.length).toBe(6)
    expect(latest.gpus.every((g: any) => g.deviceKey)).toBe(true)
    expect(latest.vgpus.map((v: any) => [v.vmid, v.profile])).toEqual([['200', 'A40-8Q'], ['249', 'A40-4Q'], ['1101', 'A40-12Q']])
    expect(latest.vgpuTypes.every((t: any) => t.deviceKey === A40)).toBe(true)
  })

  it('the history covers the whole range for every measured card', async () => {
    const data = (await demoGet('/api/v1/gpu/metrics/series?range=6h')).body.data

    expect(data.series).toHaveLength(6)
    for (const s of data.series) expect(s.points).toHaveLength((data.to - data.from) / data.stepSeconds)
    expect(data.series.find((s: any) => s.vmid === '1101').deviceKey).toBe(A40)
  })

  it('a GPU VM config carries its hostpci and the SMBIOS UUID its vGPU is read by', async () => {
    const cfg = (await demoGet(`/api/v1/connections/${PROD}/guests/qemu/pve-node-03/1101/config`)).body
    const data = cfg.data ?? cfg

    expect(data.hostpci0).toBe('mapping=a40-vgpu,mdev=nvidia-563,pcie=1')
    expect(data.smbios1).toBe('uuid=00000000-0000-4000-9000-000000001101')
  })

  it('the Acme VMs are in the production inventory, in their vDC pool', async () => {
    const res = (await demoGet(`/api/v1/connections/${PROD}/resources`)).body.data
    const acme = DEMO_GPU_GUESTS.filter(g => g.pool === 'vdc-acme-acme-prod').map(g => g.vmid)

    for (const vmid of acme) expect(res.find((r: any) => r.vmid === vmid)?.pool).toBe('vdc-acme-acme-prod')
  })

  it('Acme Production has its contingent, its GPU VMs and its hours; a vDC without one has no GPU section', async () => {
    const view = (await demoGet('/api/v1/vdcs/demo-vdc-acme-prod/gpu')).body.data

    expect(view.entries.map((e: any) => [e.profileName, e.used, e.count])).toEqual([['A40-12Q', 1, 2], ['A40-8Q', 1, 1]])
    expect(view.vms.map((v: any) => v.name)).toEqual(['acme-ml-01', 'acme-cad-01'])

    const hours = (await demoGet('/api/v1/vdcs/demo-vdc-acme-prod/gpu/hours?month=2026-10')).body.data

    expect(hours.totals.reservedHours).toBeGreaterThan(hours.totals.runningHours)

    expect((await demoGet('/api/v1/vdcs/demo-vdc-globex-prod/gpu')).status).toBe(404)

    const quota = (await demoGet('/api/v1/vdcs/demo-vdc-globex-prod/gpu/quota')).body.data

    expect(quota.entries).toEqual([])
    expect(quota.offers.some((o: any) => o.profileName === 'A40-12Q')).toBe(true)
  })

  it('the attach dialog gets the A40 profiles and the VMs of its node', async () => {
    const profiles = (await demoGet(`/api/v1/gpu/actions/profiles?deviceKey=${A40}`)).body.data

    expect(profiles.find((p: any) => p.name === 'A40-12Q').available).toBe(1)

    const vms = (await demoGet(`/api/v1/gpu/actions/candidates?deviceKey=${A40}`)).body.data

    expect(vms[0].status).toBe('stopped')
    expect(vms.every((v: any) => v.node === 'pve-node-03')).toBe(true)
  })
})
