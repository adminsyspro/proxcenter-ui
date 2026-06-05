import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { buildNbdkitVddkCmd, type VddkOpts } from "./vddk-cmd"

/** A running nbdkit-vddk reader: the kernel device it is attached to plus the
 *  node-side resources (socket, password file, log) that must be cleaned up. */
export interface VddkReaderHandle {
  nbdDev: string
  sock: string
  pwFile: string
  logFile?: string
}

/**
 * Attach an nbdkit unix socket to a kernel NBD device. `modprobe nbd` is a
 * no-op when the module is already loaded; `max_part=0` keeps the kernel from
 * scanning the source disk's partition table (we read it as a flat image).
 * sock/nbdDev are system-generated paths (no spaces/metacharacters), so they
 * are interpolated unescaped to match the validated spike command.
 */
export function buildNbdConnectCmd(sock: string, nbdDev: string): string {
  return `modprobe nbd max_part=0 2>/dev/null; nbd-client -unix ${sock} ${nbdDev} 2>&1`
}

/**
 * Detach the device, kill the nbdkit serving this socket (matched by its argv,
 * not a PID, so it works even after nbdkit daemonizes), and remove the socket,
 * password file, and log. Each step is best-effort so teardown never aborts on
 * an already-gone resource.
 */
export function buildReaderTeardownCmd(h: VddkReaderHandle): string {
  const files = [h.sock, h.pwFile, h.logFile].filter(Boolean).join(" ")
  // The pkill pattern is "[n]bdkit" (a one-character class), not "nbdkit":
  // pkill -f matches against each process's FULL command line, and this teardown
  // command's own shell carries the pattern string in its argv (and the sock path
  // again in the rm), so a literal "nbdkit.*<sock>" would also match — and SIGTERM —
  // the teardown shell itself (exit 143, and the rm cleanup never runs, leaking the
  // temp files). "[n]bdkit" still matches the real `nbdkit …` process but no longer
  // matches this shell's own "[n]bdkit" literal.
  return `nbd-client -d ${h.nbdDev} 2>/dev/null; pkill -f "[n]bdkit.*${h.sock}" 2>/dev/null; rm -f ${files}`
}

export interface PollOpts { intervalMs?: number; maxAttempts?: number }

/**
 * Start an nbdkit-vddk reader on the PVE node and attach it to `nbdDev`:
 *   1. write the ESXi password to opts.passwordFile (0600, no trailing newline)
 *      and launch `buildNbdkitVddkCmd(opts)` backgrounded with output to a log,
 *   2. poll until the unix socket appears (VDDK login can take a few seconds),
 *   3. attach the socket to the kernel NBD device.
 * On socket timeout the nbdkit log is read back so the caller sees the real
 * VDDK failure (bad thumbprint, snapshot gone, …) rather than a bare timeout.
 */
export async function startVddkReader(
  connectionId: string,
  nodeIp: string,
  opts: VddkOpts,
  esxiPassword: string,
  nbdDev: string,
  poll: PollOpts = {},
): Promise<VddkReaderHandle> {
  const intervalMs = poll.intervalMs ?? 1000
  const maxAttempts = poll.maxAttempts ?? 60
  const logFile = `${opts.sock}.log`

  // Write the password file, clear any stale socket, then background nbdkit.
  // umask 077 in a subshell makes the password file 0600; printf '%s' writes no
  // trailing newline, which nbdkit's `password=+FILE` would otherwise treat as
  // part of the password.
  const launch =
    `(umask 077; printf '%s' ${shellEscape(esxiPassword)} > ${shellEscape(opts.passwordFile)}); ` +
    `fuser -k ${shellEscape(opts.sock)} 2>/dev/null; rm -f ${shellEscape(opts.sock)}; ` +
    `nohup ${buildNbdkitVddkCmd(opts)} > ${shellEscape(logFile)} 2>&1 & echo $!`
  const launchRes = await executeSSH(connectionId, nodeIp, launch)
  if (!launchRes.success) {
    throw new Error(`failed to launch nbdkit-vddk: ${launchRes.error || launchRes.output}`)
  }

  // Poll for the listening socket.
  let ready = false
  for (let i = 0; i < maxAttempts; i++) {
    const check = await executeSSH(connectionId, nodeIp, `test -S ${shellEscape(opts.sock)} && echo EXISTS`)
    if (check.output?.includes("EXISTS")) { ready = true; break }
    if (intervalMs > 0) await new Promise(r => setTimeout(r, intervalMs))
  }
  if (!ready) {
    const log = await executeSSH(connectionId, nodeIp, `cat ${shellEscape(logFile)} 2>/dev/null | tail -n 20`)
    await stopVddkReader(connectionId, nodeIp, { nbdDev, sock: opts.sock, pwFile: opts.passwordFile, logFile }).catch(() => {})
    throw new Error(`nbdkit-vddk socket never appeared. nbdkit log: ${log.output?.trim() || "(empty)"}`)
  }

  // Attach the socket to the kernel device.
  const connect = await executeSSH(connectionId, nodeIp, buildNbdConnectCmd(opts.sock, nbdDev))
  if (!connect.success) {
    // The VDDK failure detail lands in the nbdkit log (and the nbd-client output
    // via 2>&1), not in the orchestrator's generic exit message — read both
    // before teardown removes the log.
    const log = await executeSSH(connectionId, nodeIp, `cat ${shellEscape(logFile)} 2>/dev/null | tail -n 40`)
    await stopVddkReader(connectionId, nodeIp, { nbdDev, sock: opts.sock, pwFile: opts.passwordFile, logFile }).catch(() => {})
    throw new Error(`nbd-client failed to attach ${nbdDev}: ${(connect.output || connect.error || "").trim()} | nbdkit log: ${log.output?.trim() || "(empty)"}`)
  }

  return { nbdDev, sock: opts.sock, pwFile: opts.passwordFile, logFile }
}

/** Tear down a reader started by startVddkReader. Best-effort; safe to call twice. */
export async function stopVddkReader(connectionId: string, nodeIp: string, handle: VddkReaderHandle): Promise<void> {
  await executeSSH(connectionId, nodeIp, buildReaderTeardownCmd(handle))
}
