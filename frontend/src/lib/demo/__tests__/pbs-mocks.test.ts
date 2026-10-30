import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'
import { demoPbsTasks } from '../mocks/pbs'

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

const P1 = '/api/v1/pbs/demo-pbs-001'
const P2 = '/api/v1/pbs/demo-pbs-002'

describe('demo PBS mocks', () => {
  it('access control lists users with tokens, roles and ACL entries', async () => {
    const users = await demoGet(`${P1}/access/users`)
    const roles = await demoGet(`${P1}/access/roles`)
    const acl = await demoGet(`${P1}/access/acl`)

    expect(users.data.some((u: any) => Array.isArray(u.tokens) && u.tokens.length > 0)).toBe(true)
    expect(roles.data.find((r: any) => r.roleid === 'Admin')).toBeTruthy()
    expect(acl.data.every((a: any) => a.ugid && a.roleid && a.path)).toBe(true)
  })

  it('info gives each server its own baseUrl, unknown ids fall back to PBS Master', async () => {
    expect((await demoGet(`${P1}/info`)).data.baseUrl).toBe('https://10.10.10.50:8007')
    expect((await demoGet(`${P2}/info`)).data.baseUrl).toBe('https://10.10.10.51:8007')
    expect((await demoGet('/api/v1/pbs/some-other-pbs/info')).data.baseUrl).toBe('https://10.10.10.50:8007')
  })

  it('object-shaped tabs get objects, not the list fallback', async () => {
    const notes = await demoGet(`${P2}/notes`)
    const sub1 = await demoGet(`${P1}/subscription`)
    const sub2 = await demoGet(`${P2}/subscription`)
    const repos = await demoGet(`${P1}/repositories`)

    expect(typeof notes.data.notes).toBe('string')
    expect(sub1.data.status).toBe('active')
    expect(sub2.data.status).toBe('notfound')
    expect(Array.isArray(repos.data)).toBe(false)
    expect(repos.data.files.length).toBeGreaterThan(0)
    expect(repos.data['standard-repos'].map((r: any) => r.handle)).toContain('enterprise')
  })

  it('disks differ per server', async () => {
    const z1 = await demoGet(`${P1}/disks/zfs`)
    const d2 = await demoGet(`${P2}/disks/directory`)

    expect(z1.data[0].name).toBe('backup-main')
    expect(d2.data[0].path).toBe('/mnt/datastore/backup-replica')
    expect((await demoGet(`${P1}/disks`)).data.length).toBeGreaterThan((await demoGet(`${P2}/disks`)).data.length)
  })

  it('tape: LTO setup on PBS Master, empty but supported on the replica', async () => {
    for (const kind of ['drives', 'changers', 'media-pools', 'jobs', 'media']) {
      const a = await demoGet(`${P1}/tape/${kind}`)
      const b = await demoGet(`${P2}/tape/${kind}`)

      expect(a.data.length, kind).toBeGreaterThan(0)
      expect(b.data, kind).toEqual([])
      expect(Boolean(b.notSupported)).toBe(false)
    }
  })

  it('syslog returns journal lines honouring lastentries and service', async () => {
    const body = await demoGet(`${P1}/syslog?lastentries=50`)

    expect(body.data.source).toBe('journal')
    expect(body.data.lines).toHaveLength(50)
    const filtered = await demoGet(`${P1}/syslog?lastentries=200&service=sshd`)

    expect(filtered.data.lines.every((l: string) => l.includes('sshd'))).toBe(true)
  })

  it('tasks honour running/errors filters and the log resolves by upid', async () => {
    const running = await demoGet(`${P1}/tasks?running=1&limit=50`)

    expect(running.data.length).toBe(1)
    expect(running.data[0].endtime).toBeUndefined()
    const all = await demoGet(`${P1}/tasks?running=0&limit=20`)

    expect(all.data).toHaveLength(20)
    expect(all.total).toBe(20)
    const done = all.data.find((t: any) => t.endtime)
    const log = await demoGet(`${P1}/tasks/${encodeURIComponent(done.upid)}/log?start=0&limit=500`)

    expect(log.data.log.length).toBeGreaterThan(0)
    expect(log.data.status.status).toBe('stopped')
  })

  it('task list is stable for a given instant', () => {
    expect(demoPbsTasks('demo-pbs-002', 1_800_000_000)).toEqual(demoPbsTasks('demo-pbs-002', 1_800_000_000))
  })

  it('server and datastore RRD carry the fields the charts read', async () => {
    const srv = await demoGet(`${P1}/rrd?timeframe=hour`)
    const ds = await demoGet(`${P2}/datastores/backup-replica/rrd?timeframe=day`)

    expect(srv.data).toHaveLength(60)
    expect(srv.data[0]).toEqual(expect.objectContaining({ time: expect.any(Number), cpu: expect.any(Number), memUsedPercent: expect.any(Number) }))
    expect(ds.data[0]).toEqual(expect.objectContaining({ total: 10995116277760, used: expect.any(Number), readIops: expect.any(Number) }))
  })

  it('changelog and backup content answer object bodies', async () => {
    const cl = await demoGet(`${P1}/updates/changelog?name=proxmox-backup-server&version=3.2.8-1`)

    expect(cl.data.changelog).toContain('proxmox-backup-server (3.2.8-1)')
    const id = encodeURIComponent('backup-main/ct/106/1790812800')
    const archives = await demoGet(`${P1}/backups/${id}/content`)

    expect(archives.data.files.some((f: any) => f.browsable)).toBe(true)
    const root = await demoGet(`${P1}/backups/${id}/content?archive=root.pxar.didx&filepath=%2Fetc`)

    expect(root.data.files.find((f: any) => f.name === 'nginx').type).toBe('directory')
  })

  it('restore pickers and admin datastore list', async () => {
    const pve = await demoGet(`${P1}/pve-storages?datastore=backup-main`)

    expect(pve.data[0]).toEqual(expect.objectContaining({ connId: 'demo-pve-cluster-001', storage: 'PBS_MASTER' }))
    expect((await demoGet('/api/v1/admin/pbs-connections/demo-pbs-002/datastores')).data).toEqual(['backup-replica'])
    expect((await demoGet('/api/v1/pbs-storages')).data[0].pbsId).toBe('demo-pbs-001')
  })
})
