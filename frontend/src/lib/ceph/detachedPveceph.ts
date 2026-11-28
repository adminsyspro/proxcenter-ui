import { pveFetch } from '@/lib/proxmox/client'
import { executeSSH, shellEscape } from '@/lib/ssh/exec'
import type { SshTarget } from '@/lib/ssh/node-endpoint-core'
import { asRoot } from '@/lib/ssh/sudo'

import { detachedExit, detachedOutput } from './detachedLog'

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

/**
 * Start `argv` as root under nohup; its output and exit code go to the account's log for `tag`.
 * `answerYes` feeds `yes` on its input: `pveceph install` runs `apt-get install` without -y
 * and, with no terminal, reads the confirmation as end of input and aborts (measured on PVE
 * 9.2.2, ui#1450). The pipe runs as the account; only pveceph goes through sudo.
 */
export async function runDetached(connId: string, target: SshTarget, argv: string[], tag: string, opts: { answerYes?: boolean } = {}): Promise<{ started: true; logPath: string } | { started: false; error: string }> {
  if (!TAG_RE.test(tag)) return { started: false, error: 'Invalid log tag' }
  const inner = `${opts.answerYes ? 'yes | ' : ''}${asRoot(argvLine(argv))} > "$1" 2>&1; echo "PXC_EXIT:$?" >> "$1"`
  // A directory or log the account cannot write stops here: no start is reported for a run that never logs.
  const command = [
    `D="${DETACHED_LOG_DIR}"`,
    'mkdir -p "$D" && chmod 700 "$D" || { echo PXC_NO_LOGDIR; exit 1; }',
    `L="$D/${tag}.log"`,
    'rm -f "$L" && : > "$L" || { echo PXC_NO_LOGDIR; exit 1; }',
    `nohup sh -c ${shellEscape(inner)} pxc "$L" > /dev/null 2>&1 &`,
    'echo PXC_STARTED',
  ].join('\n')
  const result = await executeSSH(connId, target, command, 30_000, { asAccount: true })
  if (!result.success) return { started: false, error: result.error || 'Failed to start pveceph' }
  const output = result.output ?? ''
  if (output.includes('PXC_NO_LOGDIR')) return { started: false, error: `The SSH account cannot write its log directory ${DETACHED_LOG_DIR} on the node` }
  if (!output.includes('PXC_STARTED')) return { started: false, error: 'pveceph did not start on the node' }
  return { started: true, logPath: logPathOf(tag) }
}

/**
 * Whether a `pveceph install` runs on the node: a second one would empty the
 * first one's log and then fail on the dpkg lock. The bracket keeps pgrep from
 * matching the probe's own command line. Reads only.
 */
export async function installRunning(connId: string, target: SshTarget): Promise<boolean> {
  const result = await executeSSH(connId, target, 'if pgrep -f "pveceph [i]nstall" >/dev/null 2>&1; then echo PXC_RUNNING; else echo PXC_IDLE; fi', 30_000, { readOnly: true, asAccount: true })
  return result.success && (result.output ?? '').includes('PXC_RUNNING')
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

export { detachedExit, detachedOutput }

export interface FollowOptions {
  tag: string
  taskType: 'cephcreateosd' | 'cephdestroyosd'
  /** The PVE task id: the device without /dev/ for a creation, `osd.<id>` for a destruction. */
  taskId: string
  /** Epoch seconds before the command started. */
  since: number
  /** UPIDs of the same type and id that existed before the run (an earlier try on the same disk): never this run's. */
  exclude?: string[]
  budgetMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** The path of the node's recent tasks of one type, the list followDetachedTask reads. */
export function taskListPath(node: string, taskType: string, since: number): string {
  return `/nodes/${encodeURIComponent(node)}/tasks?typefilter=${taskType}&since=${since}&source=all&limit=20`
}

/** The UPIDs of one type and id the node already lists: the tasks a new run must not be mistaken for. */
export async function existingTaskUpids(conn: any, node: string, taskType: string, taskId: string, since: number): Promise<string[]> {
  const tasks = await pveFetch<any[]>(conn, taskListPath(node, taskType, since)).catch(() => [])
  return (Array.isArray(tasks) ? tasks : []).filter(x => x?.type === taskType && x?.id === taskId && typeof x?.upid === 'string').map(x => x.upid)
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** The PVE task the detached command started, what it printed when it failed first, or pending. */
export async function followDetachedTask(conn: any, connId: string, target: SshTarget, node: string, opts: FollowOptions): Promise<{ upid: string } | { failed: string } | { pending: true }> {
  const budget = opts.budgetMs ?? 20_000
  const interval = opts.intervalMs ?? 1000
  const sleep = opts.sleep ?? defaultSleep
  const start = Date.now()
  const path = taskListPath(node, opts.taskType, opts.since)

  for (;;) {
    const tasks = await pveFetch<any[]>(conn, path).catch(() => [])
    const task = (Array.isArray(tasks) ? tasks : []).find(x => x?.type === opts.taskType && x?.id === opts.taskId && typeof x?.upid === 'string' && !opts.exclude?.includes(x.upid))
    if (task) return { upid: task.upid }

    const log = await readDetachedLog(connId, target, opts.tag)
    const exit = log === null ? null : detachedExit(log)
    if (exit !== null && exit !== 0) return { failed: detachedOutput(log ?? '') || `pveceph exited with code ${exit}` }
    if (exit === 0 || Date.now() - start >= budget) return { pending: true }
    await sleep(interval)
  }
}
