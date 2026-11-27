import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { executeHandover, type SshRunner } from './handover'
import type { PveCall } from './storageProof'

const CONF = `boot: order=scsi0;net0
memory: 2048
name: web-01
net0: virtio=BC:24:11:05:9C:26,bridge=vmbr0,firewall=1
scsi0: CephStoragePool:vm-100-disk-0,size=20G
smbios1: uuid=31fe231a-0a49-4a2a-9ade-90cc34f5111c
`
const FW = `[OPTIONS]
enable: 1

[RULES]
IN ACCEPT -p tcp -dport 443
`

let root: string

/** A node of each cluster, as a directory: the real commands run against it. */
function sshOn(cluster: 'src' | 'tgt', log: string[], fail?: (cmd: string) => boolean): SshRunner {
  return async (command, opts) => {
    log.push(`${cluster}: ${command}`)
    if (fail?.(command)) return { success: false, error: 'injected failure' }
    const base = join(root, cluster)
    const local = command.replaceAll('/etc/pve', `${base}/etc/pve`).replaceAll('/var/lib/proxcenter', `${base}/var/lib/proxcenter`)
    const run = spawnSync('sh', ['-c', local], { input: opts?.stdin ?? '', encoding: 'utf8' })

    return run.status === 0
      ? { success: true, output: run.stdout.trim() }
      : { success: false, error: run.stderr.trim() || `exit ${run.status}` }
  }
}

function file(cluster: 'src' | 'tgt', path: string, content?: string): string | null {
  const full = join(root, cluster, path)
  if (content !== undefined) {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  return existsSync(full) ? readFileSync(full, 'utf8') : null
}

type PveState = {
  status?: string
  ha?: any[]
  replication?: any[]
  targetVms?: any[]
  sourcePool?: string
  shared?: boolean
  startFails?: boolean
  targetConfigFails?: boolean
}

function fakePve(state: PveState) {
  const calls: string[] = []
  const pool = ['vm-100-disk-0']
  const pve = (async (conn: any, path: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push(`${conn.id} ${method} ${path}`)
    if (conn.id === 'src') {
      if (path.endsWith('/status/current')) return { status: state.status ?? 'stopped' }
      if (path === '/cluster/ha/resources') return state.ha ?? []
      if (path === '/cluster/replication') return state.replication ?? []
      if (path === '/cluster/resources?type=vm') return [{ vmid: 100, type: 'qemu', node: 'pve1', pool: state.sourcePool }]
      if (path === '/storage') return [{ storage: 'CephStoragePool', type: 'rbd' }]
      if (path.startsWith('/pools/') && method === 'PUT') return null
      if (path.includes('/storage/CephStoragePool/content')) {
        if (method === 'POST') {
          const name = new URLSearchParams(String(init?.body)).get('filename')!
          pool.push(name)

          return `CephStoragePool:${name}`
        }
        if (method === 'DELETE') {
          pool.splice(pool.findIndex(n => path.endsWith(encodeURIComponent(`CephStoragePool:${n}`))), 1)

          return 'UPID:imgdel'
        }
      }
    }
    if (conn.id === 'tgt') {
      if (path === '/cluster/resources?type=vm') return state.targetVms ?? []
      if (path === '/nodes/pve1-dr/storage') return [{ storage: 'XC-ProdCeph', type: 'rbd', content: 'images,rootdir', active: 1, enabled: 1 }]
      if (path.startsWith('/nodes/pve1-dr/storage/XC-ProdCeph/content')) {
        return (state.shared === false ? ['vm-100-disk-0'] : pool).map(n => ({ volid: `XC-ProdCeph:${n}` }))
      }
      if (path === '/nodes/pve1-dr/qemu/100/config') {
        if (state.targetConfigFails || file('tgt', '/etc/pve/nodes/pve1-dr/qemu-server/100.conf') === null) throw new Error('500 Configuration file does not exist')

        return { name: 'web-01' }
      }
      if (path === '/nodes/pve1-dr/qemu/100/status/start' && method === 'POST') {
        if (state.startFails) throw new Error('500 bridge vmbr9 does not exist')

        return 'UPID:pve1-dr:qmstart:100'
      }
    }
    throw new Error(`unexpected ${conn.id} ${method} ${path}`)
  }) as unknown as PveCall

  return { pve, calls, pool }
}

const SOURCE_CONF = '/etc/pve/nodes/pve1/qemu-server/100.conf'
const TARGET_CONF = '/etc/pve/nodes/pve1-dr/qemu-server/100.conf'
const NOW = () => new Date('2026-11-27T07:29:00.123Z')
const ARCHIVE = '/var/lib/proxcenter/handover/100-20261127T072900Z'

function input(state: PveState, opts: { start?: boolean; failSrc?: (c: string) => boolean; failTgt?: (c: string) => boolean } = {}) {
  const log: string[] = []
  const fake = fakePve(state)

  return {
    log,
    ...fake,
    run: () => executeHandover({
      type: 'qemu',
      vmid: '100',
      bridge: 'vmbr1',
      start: opts.start ?? false,
      source: { conn: { id: 'src' } as any, node: 'pve1', ssh: sshOn('src', log, opts.failSrc) },
      target: { conn: { id: 'tgt' } as any, node: 'pve1-dr', ssh: sshOn('tgt', log, opts.failTgt) },
      pve: fake.pve,
      now: NOW,
      randomId: () => 'ab12',
    }),
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pxc-handover-'))
  file('src', SOURCE_CONF, CONF)
  mkdirSync(join(root, 'tgt', '/etc/pve/nodes/pve1-dr/qemu-server'), { recursive: true })
  mkdirSync(join(root, 'tgt', '/etc/pve/firewall'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('executeHandover: the move', () => {
  it('hands the configuration over without copying a byte of disk', async () => {
    const { run, calls } = input({})

    const outcome = await run()

    expect(outcome).toMatchObject({ ok: true, storages: { CephStoragePool: 'XC-ProdCeph' }, startUpid: null, firewall: false })
    expect(file('src', SOURCE_CONF)).toBeNull()
    expect(file('src', `${ARCHIVE}.conf`)).toBe(CONF)
    expect(file('tgt', TARGET_CONF)).toBe(CONF.replace('CephStoragePool:', 'XC-ProdCeph:').replace('bridge=vmbr0', 'bridge=vmbr1'))
    expect(calls.some(c => c.includes('remote_migrate') || c.includes('/move_disk'))).toBe(false)
  })

  it('detaches the source before the target exists, so no moment has two bootable guests', async () => {
    const { run, log } = input({})

    await run()

    const detach = log.findIndex(l => l.startsWith('src:') && l.includes(`mv '${SOURCE_CONF}'`))
    const write = log.findIndex(l => l.startsWith('tgt:') && l.includes('tee'))
    expect(detach).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(detach)
  })

  it('carries the firewall rules of the guest', async () => {
    file('src', '/etc/pve/firewall/100.fw', FW)
    const { run } = input({})

    const outcome = await run()

    expect(outcome).toMatchObject({ ok: true, firewall: true })
    expect(file('tgt', '/etc/pve/firewall/100.fw')).toBe(FW)
    expect(file('src', '/etc/pve/firewall/100.fw')).toBeNull()
    expect(file('src', `${ARCHIVE}.fw`)).toBe(FW)
  })

  it('starts the guest on the target when asked and hands back the task', async () => {
    const { run } = input({}, { start: true })

    expect(await run()).toMatchObject({ ok: true, startUpid: 'UPID:pve1-dr:qmstart:100' })
  })

  it('reports a failed start without undoing a move that succeeded', async () => {
    const { run } = input({ startFails: true }, { start: true })

    const outcome = await run()

    expect(outcome).toMatchObject({ ok: true, startUpid: null, startError: expect.stringContaining('vmbr9') })
    expect(file('tgt', TARGET_CONF)).not.toBeNull()
  })

  it('takes the guest out of its source pool, which would otherwise keep a ghost entry', async () => {
    const { run, calls } = input({ sourcePool: 'web' })

    expect(await run()).toMatchObject({ ok: true, sourcePool: 'web' })
    expect(calls).toContain('src PUT /pools/web')
  })

  it('reports the ISO it had to detach', async () => {
    file('src', SOURCE_CONF, `${CONF}ide2: local:iso/debian.iso,media=cdrom\n`)
    const { run } = input({})

    const outcome = await run()

    expect(outcome).toMatchObject({ ok: true, detachedIsos: ['local:iso/debian.iso'] })
    expect(file('tgt', TARGET_CONF)).toContain('ide2: none,media=cdrom\n')
  })
})

describe('executeHandover: refusals before anything changes', () => {
  it.each([
    ['a running guest', { status: 'running' }, 'GUEST_RUNNING'],
    ['a guest under HA', { ha: [{ sid: 'vm:100' }] }, 'HA_MANAGED'],
    ['a replicated guest', { replication: [{ id: '100-0', guest: 100 }] }, 'REPLICATED'],
    ['a VMID taken on the target', { targetVms: [{ vmid: 100, node: 'pve2-dr', name: 'other' }] }, 'VMID_TAKEN'],
    ['a storage the target does not share', { shared: false }, 'STORAGE_NOT_SHARED'],
  ] as const)('refuses %s', async (_label, state, code) => {
    const { run, log } = input(state as PveState)

    expect(await run()).toMatchObject({ ok: false, code })
    expect(file('src', SOURCE_CONF)).toBe(CONF)
    expect(log.some(l => l.includes('mv ') || l.includes('tee'))).toBe(false)
  })

  it('refuses a guest bound to a device of its node', async () => {
    file('src', SOURCE_CONF, `${CONF}hostpci0: 0000:01:00.0\n`)
    const { run } = input({})

    expect(await run()).toMatchObject({ ok: false, code: 'NOT_PORTABLE', context: { keys: 'hostpci0' } })
    expect(file('src', SOURCE_CONF)).not.toBeNull()
  })

  it('refuses when the configuration cannot be read over SSH', async () => {
    const { run } = input({}, { failSrc: c => c.startsWith('cat ') })

    expect(await run()).toMatchObject({ ok: false, code: 'CONF_UNREADABLE' })
  })
})

describe('executeHandover: rollback', () => {
  it('puts the source back when the target refuses the file', async () => {
    file('src', '/etc/pve/firewall/100.fw', FW)
    const { run } = input({}, { failTgt: c => c.includes('qemu-server/100.conf') })

    expect(await run()).toMatchObject({ ok: false, code: 'TARGET_WRITE_FAILED' })
    expect(file('src', SOURCE_CONF)).toBe(CONF)
    expect(file('src', '/etc/pve/firewall/100.fw')).toBe(FW)
    expect(file('tgt', TARGET_CONF)).toBeNull()
  })

  it('never overwrites a configuration that appeared on the target in the meantime', async () => {
    file('tgt', TARGET_CONF, 'memory: 64\n')
    const { run } = input({})

    expect(await run()).toMatchObject({ ok: false, code: 'TARGET_WRITE_FAILED' })
    expect(file('tgt', TARGET_CONF)).toBe('memory: 64\n')
    expect(file('src', SOURCE_CONF)).toBe(CONF)
  })

  it('removes the target file and puts the source back when the firewall rules cannot follow', async () => {
    file('src', '/etc/pve/firewall/100.fw', FW)
    const { run } = input({}, { failTgt: c => c.includes('firewall/100.fw') })

    expect(await run()).toMatchObject({ ok: false, code: 'TARGET_WRITE_FAILED' })
    expect(file('tgt', TARGET_CONF)).toBeNull()
    expect(file('src', SOURCE_CONF)).toBe(CONF)
  })

  it('rolls back when the target cluster does not show the guest', async () => {
    const { run } = input({ targetConfigFails: true })

    expect(await run()).toMatchObject({ ok: false, code: 'TARGET_NOT_VISIBLE' })
    expect(file('tgt', TARGET_CONF)).toBeNull()
    expect(file('src', SOURCE_CONF)).toBe(CONF)
  })

  it('stops when the source could not be detached', async () => {
    const { run } = input({}, { failSrc: c => c.includes('mkdir') })

    expect(await run()).toMatchObject({ ok: false, code: 'DETACH_FAILED' })
    expect(file('src', SOURCE_CONF)).toBe(CONF)
    expect(file('tgt', TARGET_CONF)).toBeNull()
  })

  it('gives the commands to finish by hand when the rollback itself fails', async () => {
    const { run } = input({ targetConfigFails: true }, { failSrc: c => c.includes(`mv '${ARCHIVE}.conf'`) })

    const outcome = await run()

    expect(outcome).toMatchObject({ ok: false, code: 'ROLLBACK_FAILED' })
    if (outcome.ok === true) throw new Error('unreachable')
    expect(outcome.manual).toEqual([expect.stringContaining(`mv '${ARCHIVE}.conf' '${SOURCE_CONF}'`)])
  })

  it('keeps the move when only the pool cleanup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pve } = input({ sourcePool: 'web' })
    const failingPool = (async (conn: any, path: string, init?: RequestInit) => {
      if (path.startsWith('/pools/')) throw new Error('pool gone')

      return (pve as any)(conn, path, init)
    }) as PveCall
    const outcome = await executeHandover({
      type: 'qemu', vmid: '100', bridge: 'vmbr1', start: false,
      source: { conn: { id: 'src' } as any, node: 'pve1', ssh: sshOn('src', []) },
      target: { conn: { id: 'tgt' } as any, node: 'pve1-dr', ssh: sshOn('tgt', []) },
      pve: failingPool, now: NOW, randomId: () => 'ab12',
    })

    expect(outcome).toMatchObject({ ok: true })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('executeHandover: containers', () => {
  it('moves a container the API could not recreate over its root disk', async () => {
    rmSync(join(root, 'src', SOURCE_CONF))
    file('src', '/etc/pve/nodes/pve1/lxc/100.conf', 'hostname: ct\nrootfs: CephStoragePool:vm-100-disk-0,size=8G\nnet0: name=eth0,bridge=vmbr0,type=veth\n')
    mkdirSync(join(root, 'tgt', '/etc/pve/nodes/pve1-dr/lxc'), { recursive: true })
    const { pve } = fakePve({})
    const lxcPve = (async (conn: any, path: string, init?: RequestInit) => {
      if (conn.id === 'tgt' && path === '/nodes/pve1-dr/lxc/100/config') return { hostname: 'ct' }

      return (pve as any)(conn, path.replace('/lxc/', '/qemu/'), init)
    }) as PveCall

    const outcome = await executeHandover({
      type: 'lxc', vmid: '100', bridge: 'vmbr1', start: false,
      source: { conn: { id: 'src' } as any, node: 'pve1', ssh: sshOn('src', []) },
      target: { conn: { id: 'tgt' } as any, node: 'pve1-dr', ssh: sshOn('tgt', []) },
      pve: lxcPve, now: NOW, randomId: () => 'ab12',
    })

    expect(outcome).toMatchObject({ ok: true })
    expect(file('tgt', '/etc/pve/nodes/pve1-dr/lxc/100.conf')).toBe('hostname: ct\nrootfs: XC-ProdCeph:vm-100-disk-0,size=8G\nnet0: name=eth0,bridge=vmbr1,type=veth\n')
  })
})
