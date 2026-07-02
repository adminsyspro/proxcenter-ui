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
 * Attach a running nbdkit unix socket to the first FREE kernel NBD device and
 * echo the device it chose as `NBD_DEV=/dev/nbdN` (or `NBD_ALLOC_FAILED: …` and
 * a non-zero exit when none could be attached).
 *
 * `modprobe nbd` is a no-op when the module is already loaded; `max_part=0`
 * keeps the kernel from scanning the source disk's partition table (we read it
 * as a flat image).
 *
 * We iterate /dev/nbd0../dev/nbd15 and skip any device whose kernel client is
 * live (`/sys/block/nbdN/pid` non-empty), then attach to the first free one.
 * This deliberately replaces the old fixed per-disk device (#521): a /dev/nbdN
 * left allocated by a previous failed/aborted attempt (or by an unrelated NBD
 * user) keeps its pid file, so it is skipped instead of blocking every retry
 * with "nbd0 already in use". This also sidesteps a *wedged* device whose pid
 * file points at a now-dead process (`nbd-client -d` cannot reclaim it and
 * `rmmod nbd` refuses while it is held) — it stays non-empty, so we skip it and
 * use the next free device instead of failing (#521 field case).
 * We NEVER `nbd-client -d` a device we did not attach: if a candidate we saw
 * free was grabbed by a concurrent migration between the pid check and our
 * attach, our `nbd-client -unix` simply fails (the device is in use) and we move
 * on to the next candidate — detaching it here would disconnect the other job's
 * live reader and corrupt its copy. So no node-wide lock is needed.
 * `sock` is a system-generated path (no spaces/metacharacters), so it is
 * interpolated unescaped to match the validated spike command.
 */
export function buildNbdConnectCmd(sock: string): string {
  return [
    "modprobe nbd max_part=0 2>/dev/null",
    "ATTACHED=",
    "for i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do",
    "  [ -s /sys/block/nbd$i/pid ] && continue",
    `  if err=$(nbd-client -unix ${sock} /dev/nbd$i 2>&1); then ATTACHED=/dev/nbd$i; echo "NBD_DEV=$ATTACHED"; break; fi`,
    "done",
    '[ -n "$ATTACHED" ] || { echo "NBD_ALLOC_FAILED: ${err}"; exit 1; }',
  ].join("\n")
}

/**
 * Detach the device, kill the nbdkit serving this socket (matched by its argv,
 * not a PID, so it works even after nbdkit daemonizes), and remove the socket,
 * password file, and log. Each step is best-effort so teardown never aborts on
 * an already-gone resource.
 */
export function buildReaderTeardownCmd(h: VddkReaderHandle): string {
  const files = [h.sock, h.pwFile, h.logFile].filter(Boolean).join(" ")
  // Only detach a device we actually own. When attach failed before any device
  // was chosen (h.nbdDev === ""), a bare `nbd-client -d` would error and could
  // target an unintended device — so skip it entirely in that case.
  const detach = h.nbdDev ? `nbd-client -d ${h.nbdDev} 2>/dev/null; ` : ""
  // The pkill pattern is "[n]bdkit" (a one-character class), not "nbdkit":
  // pkill -f matches against each process's FULL command line, and this teardown
  // command's own shell carries the pattern string in its argv (and the sock path
  // again in the rm), so a literal "nbdkit.*<sock>" would also match — and SIGTERM —
  // the teardown shell itself (exit 143, and the rm cleanup never runs, leaking the
  // temp files). "[n]bdkit" still matches the real `nbdkit …` process but no longer
  // matches this shell's own "[n]bdkit" literal.
  return `${detach}pkill -f "[n]bdkit.*${h.sock}" 2>/dev/null; rm -f ${files}`
}

export interface PollOpts { intervalMs?: number; maxAttempts?: number }

/**
 * Start an nbdkit-vddk reader on the PVE node and attach it to a free NBD device:
 *   1. write the ESXi password to opts.passwordFile (0600, no trailing newline)
 *      and launch `buildNbdkitVddkCmd(opts)` backgrounded with output to a log,
 *   2. poll until the unix socket appears (VDDK login can take a few seconds),
 *   3. attach the socket to the first free kernel NBD device and record which
 *      one was chosen in the returned handle.
 * On socket timeout the nbdkit log is read back so the caller sees the real
 * VDDK failure (bad thumbprint, snapshot gone, …) rather than a bare timeout.
 */
export async function startVddkReader(
  connectionId: string,
  nodeIp: string,
  opts: VddkOpts,
  esxiPassword: string,
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
    // No device was attached (we never reached the attach step), so pass nbdDev:""
    // — teardown must not `nbd-client -d` a device this reader never owned.
    await stopVddkReader(connectionId, nodeIp, { nbdDev: "", sock: opts.sock, pwFile: opts.passwordFile, logFile }).catch(() => {})
    throw new Error(`nbdkit-vddk socket never appeared. nbdkit log: ${log.output?.trim() || "(empty)"}`)
  }

  // Attach the socket to the first free kernel NBD device; the command echoes
  // the device it chose as "NBD_DEV=/dev/nbdN".
  const connect = await executeSSH(connectionId, nodeIp, buildNbdConnectCmd(opts.sock))
  const nbdDev = (connect.output ?? "")
    .split("\n").map(l => l.trim())
    .find(l => l.startsWith("NBD_DEV="))?.slice("NBD_DEV=".length).trim() ?? ""
  if (!connect.success || !nbdDev) {
    // The VDDK failure detail lands in the nbdkit log (and the nbd-client output
    // via the command's NBD_ALLOC_FAILED echo), not in the orchestrator's generic
    // exit message — read both before teardown removes the log.
    const log = await executeSSH(connectionId, nodeIp, `cat ${shellEscape(logFile)} 2>/dev/null | tail -n 40`)
    await stopVddkReader(connectionId, nodeIp, { nbdDev, sock: opts.sock, pwFile: opts.passwordFile, logFile }).catch(() => {})
    throw new Error(`nbd-client failed to attach a free NBD device: ${(connect.output || connect.error || "").trim()} | nbdkit log: ${log.output?.trim() || "(empty)"}`)
  }

  return { nbdDev, sock: opts.sock, pwFile: opts.passwordFile, logFile }
}

/** Tear down a reader started by startVddkReader. Best-effort; safe to call twice. */
export async function stopVddkReader(connectionId: string, nodeIp: string, handle: VddkReaderHandle): Promise<void> {
  await executeSSH(connectionId, nodeIp, buildReaderTeardownCmd(handle))
}
