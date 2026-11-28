import { pveFetch } from '@/lib/proxmox/client'
import { executeSSH, shellEscape } from '@/lib/ssh/exec'
import type { SshTarget } from '@/lib/ssh/node-endpoint-core'
import { asRoot } from '@/lib/ssh/sudo'

/*
   pveceph over SSH, detached (ui#1450). The pveceph CLI runs its worker in
   the foreground and waits for the task to end (PVE's RESTEnvironment
   fork_worker in a CLI context), and an OSD on a large disk takes longer than
   a route may last (nginx cuts at 60 s). So the command runs under nohup, its
   output in a log the SSH account writes itself in $HOME/.cache/proxcenter
   (only pveceph goes through sudo), and the route looks for the PVE task the
   command started. A pveceph that fails before any task exists (a disk in
   use, a missing package) leaves its message and exit code in that log.
*/

export type SudoVerdict = 'ok' | 'missing-rule' | 'ssh-disabled' | 'unreachable'

export const DETACHED_LOG_DIR = '$HOME/.cache/proxcenter'
const TAG_RE = /^[a-z0-9-]{1,64}$/
const EXIT_RE = /PXC_EXIT:(\d+)/

const argvLine = (argv: string[]) => argv.map(shellEscape).join(' ')
const logPathOf = (tag: string) => `${DETACHED_LOG_DIR}/${tag}.log`

/**
 * Whether the SSH account may run `argv` as root on the node: root itself, or
 * `sudo -n -l` allowing that exact command (the ceph-provisioning profile).
 * Asks without running anything.
 */
export async function sudoAllows(connId: string, target: SshTarget, argv: string[]): Promise<SudoVerdict> {
  const command = `if [ "$(id -u)" = 0 ]; then echo PXC_OK; elif command -v sudo >/dev/null 2>&1 && sudo -n -l ${argvLine(argv)} >/dev/null 2>&1; then echo PXC_OK; else echo PXC_NO; fi`
  const result = await executeSSH(connId, target, command, 30_000, { readOnly: true, asAccount: true })
  if (!result.success) return /SSH not enabled/i.test(result.error ?? '') ? 'ssh-disabled' : 'unreachable'
  return (result.output ?? '').includes('PXC_OK') ? 'ok' : 'missing-rule'
}

/** Start `argv` as root under nohup; its output and exit code go to the account's log for `tag`. */
export async function runDetached(connId: string, target: SshTarget, argv: string[], tag: string): Promise<{ started: true; logPath: string } | { started: false; error: string }> {
  if (!TAG_RE.test(tag)) return { started: false, error: 'Invalid log tag' }
  const inner = `${asRoot(argvLine(argv))} > "$1" 2>&1; echo "PXC_EXIT:$?" >> "$1"`
  const command = [
    `D="${DETACHED_LOG_DIR}"`,
    'mkdir -p "$D" && chmod 700 "$D"',
    `L="$D/${tag}.log"`,
    'rm -f "$L"',
    `nohup sh -c ${shellEscape(inner)} pxc "$L" > /dev/null 2>&1 &`,
    'echo PXC_STARTED',
  ].join('\n')
  const result = await executeSSH(connId, target, command, 30_000, { asAccount: true })
  if (!result.success) return { started: false, error: result.error || 'Failed to start pveceph' }
  return { started: true, logPath: logPathOf(tag) }
}

/** The account's log for `tag`; null when there is none or it cannot be read. */
export async function readDetachedLog(connId: string, target: SshTarget, tag: string): Promise<string | null> {
  if (!TAG_RE.test(tag)) return null
  const path = logPathOf(tag)
  const result = await executeSSH(connId, target, `if [ -f "${path}" ]; then tail -n 200 "${path}"; else echo PXC_NO_LOG; fi`, 30_000, { readOnly: true, asAccount: true })
  if (!result.success) return null
  const output = result.output ?? ''
  return output.trim() === 'PXC_NO_LOG' ? null : output
}

/** The exit code a finished detached command wrote, null while it runs. */
export function detachedExit(log: string): number | null {
  const m = EXIT_RE.exec(log)
  return m ? Number(m[1]) : null
}

/** The log without its exit marker, the last `lines` lines. */
export function detachedOutput(log: string, lines = 20): string {
  return log.split('\n').filter(l => l.trim() !== '' && !EXIT_RE.test(l)).slice(-lines).join('\n')
}

export interface FollowOptions {
  tag: string
  taskType: 'cephcreateosd' | 'cephdestroyosd'
  /** The PVE task id: the device without /dev/ for a creation, `osd.<id>` for a destruction. */
  taskId: string
  /** Epoch seconds before the command started. */
  since: number
  budgetMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** The PVE task the detached command started, what it printed when it failed first, or pending. */
export async function followDetachedTask(conn: any, connId: string, target: SshTarget, node: string, opts: FollowOptions): Promise<{ upid: string } | { failed: string } | { pending: true }> {
  const budget = opts.budgetMs ?? 20_000
  const interval = opts.intervalMs ?? 1000
  const sleep = opts.sleep ?? defaultSleep
  const start = Date.now()
  const path = `/nodes/${encodeURIComponent(node)}/tasks?typefilter=${opts.taskType}&since=${opts.since}&source=all&limit=20`

  for (;;) {
    const tasks = await pveFetch<any[]>(conn, path).catch(() => [])
    const task = (Array.isArray(tasks) ? tasks : []).find(x => x?.type === opts.taskType && x?.id === opts.taskId && typeof x?.upid === 'string')
    if (task) return { upid: task.upid }

    const log = await readDetachedLog(connId, target, opts.tag)
    const exit = log === null ? null : detachedExit(log)
    if (exit !== null && exit !== 0) return { failed: detachedOutput(log ?? '') || `pveceph exited with code ${exit}` }
    if (exit === 0 || Date.now() - start >= budget) return { pending: true }
    await sleep(interval)
  }
}
