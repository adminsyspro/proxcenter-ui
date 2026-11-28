import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ssh/exec', async (orig) => ({ ...(await orig<typeof import('@/lib/ssh/exec')>()), executeSSH: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))

import { executeSSH } from '@/lib/ssh/exec'
import { pveFetch } from '@/lib/proxmox/client'
import { FRONTEND_SUDO_RULES, resolveSudo, sudoSegments, verifySudo } from '@/lib/ssh/sudo'
import { followDetachedTask, installRunning, readDetachedLog, runDetached, sudoAllows } from './detachedPveceph'
import { osdCreateArgv } from './pvecephCommands'

/*
   ui#1450: pveceph runs detached on the node (its CLI waits for the task, an
   OSD on a large disk takes longer than a route may), its output in a log of
   the SSH account. The route then finds the PVE task it started, or the error
   pveceph printed before any task existed (a disk in use, a missing package).
*/

const sshMock = executeSSH as any
const pveMock = pveFetch as any
const conn = { id: 'c1' }
const noSleep = async () => {}
const ARGV = osdCreateArgv({ dev: '/dev/sdb' })

beforeEach(() => vi.clearAllMocks())

describe('sudoAllows', () => {
  it('reads the verdict of the node', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_OK\n' })
    expect(await sudoAllows('c1', 'pve1', ARGV)).toBe('ok')
    sshMock.mockResolvedValue({ success: true, output: 'PXC_NO\n' })
    expect(await sudoAllows('c1', 'pve1', ARGV)).toBe('missing-rule')
  })

  it('asks sudo about the exact command, as the account and read only', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_OK' })
    await sudoAllows('c1', 'pve1', ARGV)
    const [, target, command, , opts] = sshMock.mock.calls[0]
    expect(target).toBe('pve1')
    expect(command).toContain("sudo -n -l '/usr/bin/pveceph' 'osd' 'create' '/dev/sdb'")
    expect(command).toContain('"$(id -u)" = 0')
    expect(opts).toEqual({ readOnly: true, asAccount: true })
  })

  it('tells a connection without SSH from an unreachable node', async () => {
    sshMock.mockResolvedValue({ success: false, error: 'SSH not enabled for this connection' })
    expect(await sudoAllows('c1', 'pve1', ARGV)).toBe('ssh-disabled')
    sshMock.mockResolvedValue({ success: false, error: 'connect ECONNREFUSED' })
    expect(await sudoAllows('c1', 'pve1', ARGV)).toBe('unreachable')
  })
})

describe('runDetached', () => {
  it('starts the command in the background, its output in the account log, each program allowed by a rule', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_STARTED\n' })
    expect(await runDetached('c1', 'pve1', ARGV, 'ceph-osd-create-sdb')).toEqual({ started: true, logPath: '$HOME/.cache/proxcenter/ceph-osd-create-sdb.log' })
    const command: string = sshMock.mock.calls[0][2]
    expect(command).toContain('nohup sh -c')
    expect(command).toContain('PXC_EXIT:$?')
    expect(command).toContain('"$HOME/.cache/proxcenter"')
    expect(verifySudo(resolveSudo(command, true), FRONTEND_SUDO_RULES)).toEqual([])
    expect(sudoSegments(resolveSudo(command, true))).toEqual([ARGV])
    expect(resolveSudo(command, false)).not.toContain('sudo')
  })

  it('is a valid POSIX shell script, for root and for a sudo account', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_STARTED\n' })
    await runDetached('c1', 'pve1', ARGV, 'ceph-osd-create-sdb')
    const command: string = sshMock.mock.calls[0][2]
    for (const useSudo of [false, true]) {
      expect(() => execFileSync('sh', ['-n', '-c', resolveSudo(command, useSudo)]), String(useSudo)).not.toThrow()
    }
  })

  it('answers yes to apt for pveceph install, which runs apt-get install without -y (measured on PVE 9.2)', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_STARTED' })
    await runDetached('c1', 'pve1', ['/usr/bin/pveceph', 'install', '--version', 'tentacle', '--repository', 'no-subscription'], 'ceph-install', { answerYes: true })
    const command: string = sshMock.mock.calls[0][2]
    expect(command).toContain('yes | ')
    expect(verifySudo(resolveSudo(command, true), FRONTEND_SUDO_RULES)).toEqual([])
    for (const useSudo of [false, true]) expect(() => execFileSync('sh', ['-n', '-c', resolveSudo(command, useSudo)])).not.toThrow()
    await runDetached('c1', 'pve1', ARGV, 'ceph-osd-create-sdb')
    expect(sshMock.mock.calls[1][2]).not.toContain('yes | ')
  })

  it('refuses a tag that could leave the log directory', async () => {
    expect(await runDetached('c1', 'pve1', ARGV, '../x')).toEqual({ started: false, error: 'Invalid log tag' })
    expect(sshMock).not.toHaveBeenCalled()
  })

  it('reports a log directory the account cannot write, instead of a start', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_NO_LOGDIR\n' })
    expect(await runDetached('c1', 'pve1', ARGV, 'ceph-osd-create-sdb')).toEqual({ started: false, error: expect.stringMatching(/cannot write its log directory/) })
    const command: string = sshMock.mock.calls[0][2]
    expect(command).toContain('PXC_NO_LOGDIR')
    sshMock.mockResolvedValue({ success: true, output: '' })
    expect((await runDetached('c1', 'pve1', ARGV, 'ceph-osd-create-sdb')).started).toBe(false)
  })

  it('reports an SSH failure', async () => {
    sshMock.mockResolvedValue({ success: false, error: 'Permission denied (publickey)' })
    expect(await runDetached('c1', 'pve1', ARGV, 'ceph-osd-create-sdb')).toEqual({ started: false, error: 'Permission denied (publickey)' })
  })
})

describe('followDetachedTask', () => {
  const opts = { tag: 'ceph-osd-create-sdb', taskType: 'cephcreateosd' as const, taskId: 'sdb', since: 1795850000, intervalMs: 0, sleep: noSleep }
  const UPID = 'UPID:pve1:000C1:0D2:6B0A8:cephcreateosd:sdb:root@pam:'

  it('returns the UPID once the task shows up', async () => {
    let calls = 0
    pveMock.mockImplementation(async () => (++calls < 3 ? [] : [{ type: 'cephcreateosd', id: 'sdc', upid: 'other', user: 'root@pam' }, { type: 'cephcreateosd', id: 'sdb', upid: UPID, user: 'root@pam' }]))
    sshMock.mockResolvedValue({ success: true, output: '' })
    expect(await followDetachedTask(conn, 'c1', 'pve1', 'pve1', opts)).toEqual({ upid: UPID })
    expect(pveMock.mock.calls[0][1]).toBe('/nodes/pve1/tasks?typefilter=cephcreateosd&since=1795850000&source=all&limit=20')
  })

  it('skips the tasks that existed before the run (a retry of the same disk)', async () => {
    const OLD = 'UPID:pve1:000B1:0C1:6B0A1:cephcreateosd:sdb:root@pam:'
    let calls = 0
    pveMock.mockImplementation(async () => (++calls < 2
      ? [{ type: 'cephcreateosd', id: 'sdb', upid: OLD }]
      : [{ type: 'cephcreateosd', id: 'sdb', upid: UPID }, { type: 'cephcreateosd', id: 'sdb', upid: OLD }]))
    sshMock.mockResolvedValue({ success: true, output: '' })
    expect(await followDetachedTask(conn, 'c1', 'pve1', 'pve1', { ...opts, exclude: [OLD] })).toEqual({ upid: UPID })
  })

  it('returns what pveceph printed when it failed before any task', async () => {
    pveMock.mockResolvedValue([])
    sshMock.mockResolvedValue({ success: true, output: "device '/dev/sdb' is already in use\nPXC_EXIT:255\n" })
    expect(await followDetachedTask(conn, 'c1', 'pve1', 'pve1', opts)).toEqual({ failed: "device '/dev/sdb' is already in use" })
  })

  it('reads the log as the account, read only', async () => {
    pveMock.mockResolvedValue([])
    sshMock.mockResolvedValue({ success: true, output: 'x\nPXC_EXIT:1\n' })
    await followDetachedTask(conn, 'c1', 'pve1', 'pve1', opts)
    expect(sshMock.mock.calls[0][2]).toContain('"$HOME/.cache/proxcenter/ceph-osd-create-sdb.log"')
    expect(sshMock.mock.calls[0][4]).toEqual({ readOnly: true, asAccount: true })
  })

  it('stays pending when the budget runs out', async () => {
    pveMock.mockResolvedValue([])
    sshMock.mockResolvedValue({ success: true, output: 'still running\n' })
    expect(await followDetachedTask(conn, 'c1', 'pve1', 'pve1', { ...opts, budgetMs: 0 })).toEqual({ pending: true })
  })
})

describe('readDetachedLog', () => {
  it('tells a missing log from an empty one', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_NO_LOG\n' })
    expect(await readDetachedLog('c1', 'pve1', 'ceph-install')).toBeNull()
    sshMock.mockResolvedValue({ success: true, output: '' })
    expect(await readDetachedLog('c1', 'pve1', 'ceph-install')).toBe('')
    expect(sshMock.mock.calls[0][2]).toContain('if [ -f "$HOME/.cache/proxcenter/ceph-install.log" ]')
  })
})

describe('installRunning', () => {
  it('tells whether a pveceph install runs on the node, without matching its own probe', async () => {
    sshMock.mockResolvedValue({ success: true, output: 'PXC_RUNNING\n' })
    expect(await installRunning('c1', 'pve1')).toBe(true)
    expect(sshMock.mock.calls[0][2]).toContain('pveceph [i]nstall')
    expect(sshMock.mock.calls[0][4]).toEqual({ readOnly: true, asAccount: true })
    sshMock.mockResolvedValue({ success: true, output: 'PXC_IDLE\n' })
    expect(await installRunning('c1', 'pve1')).toBe(false)
  })
})
