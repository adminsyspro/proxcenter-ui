import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'

const demoGet = async (path: string, method = 'GET'): Promise<any> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`, { method }))

    return res ? await res.json() : null
  } finally {
    process.env.DEMO_MODE = prev
  }
}

const PROD = '/api/v1/connections/demo-pve-cluster-001/nodes/pve-node-03'
const DR = '/api/v1/connections/demo-pve-dr-001/nodes/pve-dr-03'

describe('demo node panel mocks', () => {
  it('notes, subscription and maintenance are objects for both clusters', async () => {
    for (const base of [PROD, DR]) {
      expect(typeof (await demoGet(`${base}/notes`)).data.notes).toBe('string')
      expect((await demoGet(`${base}/subscription`)).data).toEqual(expect.objectContaining({ status: 'active', key: expect.any(String) }))
      expect((await demoGet(`${base}/maintenance`)).data).toEqual({ maintenance: null })
    }
    expect((await demoGet(`${DR}/notes`)).data.notes).toContain('pve-dr-03')
  })

  it('sensors carry readings, byRole and hottest', async () => {
    const body = await demoGet(`${PROD}/sensors`)

    expect(body.data.available).toBe(true)
    expect(body.data.byRole.map((r: any) => r.role)).toEqual(expect.arrayContaining(['cpu', 'disk', 'memory']))
    expect(body.data.hottest.celsius).toBeGreaterThan(0)
  })

  it('system sections match the node network and hosts file', async () => {
    const body = await demoGet(`${DR}/system`)

    expect(body.data.network.length).toBeGreaterThan(0)
    expect(body.data.network[0].type).toBe('bridge')
    expect(body.data.hosts.data).toContain('pve-dr-01')
    expect(body.data.time.timezone).toBe('Europe/Paris')
    expect((await demoGet(`${PROD}/system?section=time`)).data.timezones).toContain('UTC')
    expect((await demoGet(`${PROD}/network/vmbr0`)).data.iface).toBe('vmbr0')
  })

  it('ceph tab and noout: prod healthy, DR with osd.10 down on pve-dr-03', async () => {
    const prod = await demoGet(`${PROD}/ceph`)
    const dr = await demoGet(`${DR}/ceph`)

    expect(prod.data.hasCeph).toBe(true)
    expect(prod.data.health.status).toBe('HEALTH_OK')
    expect(prod.data.osds).toHaveLength(36)
    expect(prod.data.monitors[0]).toEqual(expect.objectContaining({ name: 'pve-node-01', quorum: 1 }))
    expect(dr.data.health.status).toBe('HEALTH_ERR')
    expect(dr.data.osds.find((o: any) => o.id === 10).up).toBe(false)
    expect((await demoGet(`${PROD}/ceph?section=log`)).data.log.length).toBeGreaterThan(0)

    const noout = await demoGet(`${DR}/ceph/noout?precheck=1`)

    expect(noout.data.osds.map((o: any) => o.id)).toEqual([2, 6, 10])
    expect(noout.data.globalNoout).toBe(true)
    expect(noout.data.okToStop.ok).toBe(false)
  })

  it('local-vms, replication and upgrade carry the shapes NodeUpdateDialog reads', async () => {
    const local = await demoGet('/api/v1/connections/demo-pve-cluster-001/nodes/pve-node-09/local-vms')

    expect(local.data.localVms[0]).toEqual(expect.objectContaining({ name: 'nas-01', localDisks: ['scsi1: local'] }))
    expect(local.data.summary.canMigrate).toBe(false)
    const repl = await demoGet(`${DR}/replication`)

    expect(repl.data.jobs).toEqual([])
    expect(repl.data.guests.every((g: any) => g.vmid > 5000)).toBe(true)
    expect(repl.data.nodes.map((n: any) => n.node)).not.toContain('pve-dr-03')
    expect(await demoGet(`${PROD}/upgrade`)).toEqual({ status: 'UNKNOWN', logs: '', reboot_required: false })
  })

  it('apt, repositories and updates', async () => {
    const apt = await demoGet(`${PROD}/apt`)

    expect(apt.count).toBe(apt.data.length)
    expect(apt.data.find((p: any) => p.package === 'pve-manager').newVersion).toBe('8.4.5')
    expect(apt.nodeVersion).toBe('8.4.1')
    expect((await demoGet('/api/v1/connections/demo-pve-cluster-001/nodes/pve-node-12/apt')).count).toBe(0)
    expect((await demoGet(`${DR}/apt/repositories`)).data.standard_repos[0]).toEqual(expect.objectContaining({ handle: 'enterprise', status: 1 }))
    expect((await demoGet(`${DR}/updates`)).data.updates[0].Package).toBe('pve-manager')
  })

  it('creation wizard capabilities and templates', async () => {
    const cpu = await demoGet(`${PROD}/cpu-models`)

    expect(cpu.policy).toBeNull()
    expect(cpu.data.some((m: any) => m.custom === 1)).toBe(true)
    expect((await demoGet(`${PROD}/machines`)).data.every((m: any) => m.type === 'i440fx' || m.type === 'q35')).toBe(true)
    expect((await demoGet(`${PROD}/aplinfo`)).data[0]).toEqual(expect.objectContaining({ package: expect.any(String), template: expect.any(String) }))
    expect((await demoGet(`${PROD}/hardware/pci`)).data.length).toBeGreaterThan(0)
    expect((await demoGet(`${PROD}/hardware/usb`)).data.length).toBeGreaterThan(0)
  })

  it('disks list the node OSD drives and answer SMART for one', async () => {
    const all = await demoGet(`${PROD}/disks`)
    const osdDisks = all.data.disks.filter((d: any) => d.osdid >= 0)

    expect(osdDisks.map((d: any) => d.osdid)).toEqual([2, 14, 26])
    expect(Array.isArray(all.data.lvm)).toBe(true)
    const smart = await demoGet(`${PROD}/disks?section=disks&disk=${encodeURIComponent('/dev/sda')}`)

    expect(smart.data.smart.attributes.length).toBeGreaterThan(0)
  })

  it('syslog honours limit, storage content honours ?content=', async () => {
    const log = await demoGet(`${DR}/syslog?limit=50`)

    expect(log.data).toHaveLength(50)
    expect(log.data[0]).toContain('pve-dr-03')
    const isos = await demoGet(`${PROD}/storage/local/content?content=iso`)

    expect(isos.data.length).toBeGreaterThan(0)
    expect(isos.data.every((i: any) => i.content === 'iso')).toBe(true)
    const images = await demoGet(`${PROD}/storage/CephStoragePool/content`)

    expect(images.data.some((i: any) => i.vmid === 100)).toBe(true)
  })
})
