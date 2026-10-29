import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'

const demoCall = async (path: string, method = 'GET'): Promise<Response | null> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'
  try {
    return await demoResponse(new Request(`http://localhost${path}`, { method }))
  } finally {
    process.env.DEMO_MODE = prev
  }
}

const demoGet = async (path: string, method = 'GET'): Promise<any> => {
  const res = await demoCall(path, method)

  return res ? await res.json() : null
}

describe('operations demo mocks', () => {
  it('backup coverage lists the guests the daily job excludes', async () => {
    const body = await demoGet('/api/v1/backups/coverage')

    expect(Array.isArray(body.data.guests)).toBe(true)
    expect(body.data.guests.map((g: any) => g.vmid)).toEqual(['224', '227', '228', '229'])
    expect(body.data.guests.every((g: any) => g.reason === 'excluded' && g.jobIds.includes('backup-daily-001'))).toBe(true)
    expect(body.data.summary.uncovered).toBe(4)
    expect(body.data.summary.ignored.template).toBeGreaterThan(0)
    expect(body.data.settings).toEqual({ graceHours: 24, excludeTag: 'no-backup' })
    expect(body.data.errors).toEqual([])
    expect(typeof body.data.generatedAt).toBe('string')
  })

  it('top consumers rank the running prod guests by the metric', async () => {
    const body = await demoGet('/api/v1/dashboard/top-consumers?metric=ram&agg=avg&limit=20')

    expect(body.unit).toBe('percent')
    expect(body.items).toHaveLength(20)
    expect(body.items[0].value).toBeGreaterThanOrEqual(body.items[19].value)
    expect(body.items[0]).toMatchObject({ connId: 'demo-pve-cluster-001', status: 'running' })

    const io = await demoGet('/api/v1/dashboard/top-consumers?metric=netout&agg=max')

    expect(io.unit).toBe('bytes_per_second')
    expect(io.items).toHaveLength(10)
    expect(await demoGet('/api/v1/dashboard/top-consumers?metric=cpu&connections=demo-pve-dr-001')).toMatchObject({ items: [] })
  })

  it('network options list the vDC VNets', async () => {
    const body = await demoGet('/api/v1/templates/network-options')

    expect(body.data.options.length).toBeGreaterThan(0)
    expect(body.data.options[0]).toHaveProperty('pveName')
    expect(body.data.options[0]).toHaveProperty('vdcId')
  })

  it('report preview answers a PDF', async () => {
    const res = await demoCall('/api/v1/orchestrator/reports/preview', 'POST')

    expect(res?.headers.get('content-type')).toBe('application/pdf')
    expect((await res!.text()).startsWith('%PDF-')).toBe(true)
  })

  it('task archive pages, summarises and filters', async () => {
    const now = Math.floor(Date.now() / 1000)
    const body = await demoGet(`/api/v1/events/archive?since=${now - 7 * 86400}&until=${now}&pageSize=20`)

    expect(body.data.length).toBe(20)
    expect(body.meta.total).toBeGreaterThan(20)
    expect(body.meta.summary.total).toBe(body.meta.total)
    expect(body.meta.connections.length).toBe(2)
    expect(body.meta.nodes.length).toBeGreaterThan(0)
    expect(body.data.some((t: any) => t.family === 'backup')).toBe(true)

    const backups = await demoGet(`/api/v1/events/archive?since=${now - 7 * 86400}&until=${now}&families=backup`)

    expect(backups.data.every((t: any) => t.family === 'backup')).toBe(true)

    const again = await demoGet(`/api/v1/events/archive?since=${now - 7 * 86400}&until=${now}&pageSize=20`)

    expect(again.data.map((t: any) => t.id)).toEqual(body.data.map((t: any) => t.id))
    expect(await demoGet('/api/v1/events/archive/settings')).toMatchObject({ retentionDays: 90 })
  })

  it('restore drills: list, detail, schedules and settings agree', async () => {
    const list = await demoGet('/api/v1/backups/restore-drills?limit=20&offset=0')

    expect(list.total).toBe(list.data.length)
    expect(list.data[0].stages.length).toBe(5)

    const detail = await demoGet(`/api/v1/backups/restore-drills/${list.data[0].id}`)

    expect(detail.drill.id).toBe(list.data[0].id)
    expect(Array.isArray(detail.events)).toBe(true)

    const schedules = await demoGet('/api/v1/backups/restore-drills/schedules?limit=10&offset=0')

    expect(schedules.data).toHaveLength(1)
    const sched = await demoGet(`/api/v1/backups/restore-drills/schedules/${schedules.data[0].id}`)

    expect(sched.schedule.id).toBe(schedules.data[0].id)
    for (const run of sched.runs) {
      for (const id of run.drill_ids) expect(list.data.some((d: any) => d.id === id)).toBe(true)
    }
    const filtered = await demoGet(`/api/v1/backups/restore-drills?schedule_id=${schedules.data[0].id}`)

    expect(filtered.data.every((d: any) => d.schedule_id === schedules.data[0].id)).toBe(true)
    expect(await demoGet('/api/v1/backups/restore-drills/settings')).toMatchObject({ max_concurrent: 2, default_network_mode: 'link_down' })
  })

  it('replication job detail endpoints answer bare arrays for the listed jobs', async () => {
    const logs = await demoGet('/api/v1/orchestrator/replication/jobs/repl-001/logs')

    expect(Array.isArray(logs)).toBe(true)
    expect(logs[0]).toHaveProperty('bytes_sent')
    const vms = await demoGet('/api/v1/orchestrator/replication/jobs/repl-002/vms')

    expect(vms.map((v: any) => v.vmid)).toEqual([103, 110, 111])
    expect(vms[0].status).toBe('synced')
    const tp = await demoGet('/api/v1/orchestrator/replication/jobs/repl-003/throughput?window=6h')

    expect(tp).toHaveLength(72)
    expect(tp[0]).toHaveProperty('bytes_per_sec')
    const points = await demoGet('/api/v1/orchestrator/replication/jobs/repl-001/vms/101/restore-points')

    expect(points.target_vmid).toBe(9101)
    expect(points.restore_points.length).toBeGreaterThan(1)
    const taskLogs = await demoGet('/api/v1/orchestrator/replication/jobs/demo-job-004/logs')

    expect(taskLogs.at(-1).level).toBe('error')
  })

  it('recovery plan history, restore points and executions agree', async () => {
    const history = await demoGet('/api/v1/orchestrator/replication/plans/plan-001/history')

    expect(Array.isArray(history)).toBe(true)
    expect(history[0].type).toBe('test')
    const exec = await demoGet(`/api/v1/orchestrator/replication/executions/${history[0].id}`)

    expect(exec.id).toBe(history[0].id)
    expect(exec.vm_results).toHaveLength(4)
    const events = await demoGet(`/api/v1/orchestrator/replication/executions/${history[0].id}/events?after=2`)

    expect(events.every((e: any) => e.id > 2)).toBe(true)
    expect(await demoGet(`/api/v1/orchestrator/replication/executions/${history[0].id}/screenshots`)).toEqual([])
    const rp = await demoGet('/api/v1/orchestrator/replication/plans/plan-001/restore-points')

    expect(rp.vms.map((v: any) => v.vm_id)).toEqual([100, 101, 102, 104])
  })

  it('replication snapshots and their usage', async () => {
    const snaps = await demoGet('/api/v1/orchestrator/replication/snapshots')

    expect(Array.isArray(snaps)).toBe(true)
    expect(snaps.some((s: any) => s.is_orphan)).toBe(true)
    expect(snaps.some((s: any) => s.side === 'target' && s.cluster_id === 'demo-pve-dr-001')).toBe(true)
    const s = snaps[0]
    const usage = await demoGet(`/api/v1/orchestrator/replication/snapshots/usage?cluster=${s.cluster_id}&pool=${s.pool}&image=${s.image}&snap=${s.snapshot}&storage_engine=rbd`)

    expect(usage.provisioned_bytes).toBe(s.provisioned_bytes)
    expect(usage.used_bytes).toBeLessThan(usage.provisioned_bytes)
  })

  it('rolling update detail of the Task Center rows', async () => {
    const paused = await demoGet('/api/v1/orchestrator/rolling-updates/demo-job-002')

    expect(paused.data.status).toBe('paused')
    expect(paused.data.node_statuses).toHaveLength(12)
    expect(paused.data.completed_nodes).toBe(5)
    expect(paused.data.logs.length).toBeGreaterThan(0)
    const done = await demoGet('/api/v1/orchestrator/rolling-updates/demo-job-009')

    expect(done.data.status).toBe('completed')
    expect(done.data.node_statuses.every((n: any) => n.status === 'completed')).toBe(true)
  })

  it('backup run task detail parses the log of a generated task', async () => {
    const runs = await demoGet('/api/v1/connections/demo-pve-cluster-001/backup-jobs/runs?days=30')
    const run = runs.data.jobs[0].runs[0]
    const task = run.tasks[0]
    const body = await demoGet(`/api/v1/connections/demo-pve-cluster-001/backup-jobs/runs/${task.node}/${encodeURIComponent(task.upid)}?days=30&state=done`)

    expect(body.data.task.upid).toBe(task.upid)
    expect(body.data.log.guests.map((g: any) => g.vmid)).toEqual(task.vmids)
    expect(body.data.log.commandLine).toContain('vzdump')
    expect(body.data.totalLines).toBeGreaterThan(10)

    const failedRun = [...runs.data.jobs.flatMap((j: any) => j.runs)].find((r: any) => r.status === 'failed')

    if (failedRun) {
      const t = failedRun.tasks[0]
      const failed = await demoGet(`/api/v1/connections/demo-pve-cluster-001/backup-jobs/runs/${t.node}/${encodeURIComponent(t.upid)}`)

      expect(failed.data.log.guests[0].status).toBe('failed')
    }
  })

  it('file restore browses an archive down to a directory', async () => {
    const base = '/api/v1/connections/demo-pve-cluster-001/file-restore?storage=PBS_MASTER&volume=PBS_MASTER:backup/vm/100/2026-10-27T02:00:00Z'
    const root = await demoGet(`${base}&filepath=/`)

    expect(root.data.files[0]).toMatchObject({ name: '/drive-scsi0.img.fidx', browsable: true })
    const etc = await demoGet(`${base}&filepath=${encodeURIComponent('/drive-scsi0.img.fidx/part/2/etc')}`)

    expect(etc.data.files.some((f: any) => f.name === 'hostname' && f.type === 'file')).toBe(true)
    expect(etc.data.files[0].type).toBe('directory')
    const ct = await demoGet('/api/v1/connections/demo-pve-cluster-001/file-restore?storage=PBS_MASTER&volume=PBS_MASTER:backup/ct/300/x&filepath=/root.pxar.didx/var')

    expect(ct.data.files.map((f: any) => f.name)).toEqual(['lib', 'log', 'www'])
  })

  it('file restore preview answers text for a previewable file and refuses the rest', async () => {
    const base = '/api/v1/connections/demo-pve-cluster-001/file-restore/preview?storage=PBS_MASTER&volume=PBS_MASTER:backup/vm/100/2026-10-27T02:00:00Z'
    const ok = await demoGet(`${base}&filepath=${encodeURIComponent('/drive-scsi0.img.fidx/part/2/etc/nginx/nginx.conf')}`)

    expect(ok.data).toMatchObject({ type: 'text', filename: 'nginx.conf', truncated: false })
    expect(ok.data.content).toContain('worker_processes')
    const refused = await demoCall(`${base}&filepath=${encodeURIComponent('/drive-scsi0.img.fidx/part/2/opt/app/app.jar')}`)

    expect(refused?.status).toBe(400)
  })
})
