import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { buildNbdConnectCmd, buildReaderTeardownCmd, type PollOpts } from "./vddk-reader"
import type { Extent } from "./extents"

/** The xapi-nbd export to re-serve locally: unix socket to create, plus the
 *  TLS NBD endpoint XAPI handed us (address, port, export name with session)
 *  and the PEM certificate of that host, both from VDI.get_nbd_info. */
export interface XapiNbdTarget { sock: string; address: string; port: number; exportname: string; cert: string }

/** A running nbdkit-nbd reader: the kernel device it is attached to plus the
 *  node-side resources (socket, log, pinned-CA directory) to clean up. */
export interface XapiReaderHandle { nbdDev: string; sock: string; logFile: string; caDir: string }

/**
 * nbdkit's nbd plugin re-exports the XCP-ng xapi-nbd export (TLS on 10809) on a
 * local unix socket, exactly where the VDDK plugin sits for VMware, so nbd-client
 * and the block applier are shared. -r: warm only reads the source.
 *
 * The TLS server is VERIFIED, never trusted blindly: the export name carries the
 * XAPI session id, so a TLS interceptor on the management LAN would walk away
 * with a root session. `tls-certificates=<caDir>` points nbdkit at a directory
 * whose ca-cert.pem is the certificate VDI.get_nbd_info returned for this very
 * host, so the handshake is pinned to that self signed certificate and any other
 * CA fails it. XCP-ng host certificates carry the management IP as CN, which is
 * exactly the `address` the same authenticated XAPI call handed us, so
 * `hostname=<address>` matches the certificate as well.
 */
export function buildNbdkitXapiCmd(t: XapiNbdTarget, caDir: string): string {
  return ["nbdkit", "-r", "-U", shellEscape(t.sock), "nbd",
    `hostname=${shellEscape(t.address)}`, `port=${shellEscape(String(t.port))}`,
    `export=${shellEscape(t.exportname)}`, "tls=require",
    `tls-certificates=${shellEscape(caDir)}`].join(" ")
}

/**
 * Start an nbdkit-nbd reader on the PVE node and attach it to a free NBD device:
 *   1. write the host certificate from VDI.get_nbd_info into a private
 *      `<sock>.ca/ca-cert.pem` so nbdkit can pin the TLS server, clear any stale
 *      socket, and launch `buildNbdkitXapiCmd(t, caDir)` backgrounded with
 *      output to a log,
 *   2. poll until the unix socket appears,
 *   3. attach the socket to the first free kernel NBD device and record which
 *      one was chosen in the returned handle.
 *
 * Unlike the VDDK plugin, nbdkit's nbd plugin binds the unix socket BEFORE it
 * dials xapi-nbd, so the socket appearing proves nothing about the remote side:
 * an expired session, a refused TLS handshake or a VDI that cannot be attached
 * all surface at step 3, when nbd-client asks for the export and gets nothing.
 * A socket that never appears is therefore a local nbdkit problem (missing nbd
 * plugin, unreadable CA directory, bad option). Both failure paths read the
 * nbdkit log back before teardown removes it, so the real cause reaches the
 * caller either way.
 */
export async function startXapiReader(connectionId: string, nodeIp: string, t: XapiNbdTarget, poll: PollOpts = {}): Promise<XapiReaderHandle> {
  // Fail here rather than pin nothing: with an empty ca-cert.pem nbdkit still
  // binds the socket, so the missing certificate would only surface later as a
  // puzzling "nbd-client failed to attach a free NBD device".
  if (!t.cert || !t.cert.trim()) throw new Error("VDI.get_nbd_info returned no host certificate; cannot pin the NBD TLS connection")
  const intervalMs = poll.intervalMs ?? 1000
  const maxAttempts = poll.maxAttempts ?? 60
  const logFile = `${t.sock}.log`
  // umask 077 in a subshell keeps the CA directory, the PEM and the log private
  // to root. The log is TRUNCATED here (`: >`) rather than by the nohup
  // redirection, which runs outside the subshell and would leave it 0644 while
  // nbdkit can echo the export name (and with it the XAPI session id) into it;
  // the redirection is `>>` so it keeps the 0600 file created here. `rm -f`
  // before the truncation because `: >` on a log left 0644 by an earlier run
  // would keep that mode.
  // rm -rf first so a directory left by an aborted run cannot pin a stale (or
  // foreign) certificate for this session.
  const caDir = `${t.sock}.ca`
  const launch =
    `rm -rf ${shellEscape(caDir)}; ` +
    `(umask 077; mkdir -p ${shellEscape(caDir)}; printf '%s\\n' ${shellEscape(t.cert)} > ${shellEscape(`${caDir}/ca-cert.pem`)}; rm -f ${shellEscape(logFile)}; : > ${shellEscape(logFile)}); ` +
    `fuser -k ${shellEscape(t.sock)} 2>/dev/null; rm -f ${shellEscape(t.sock)}; ` +
    `nohup ${buildNbdkitXapiCmd(t, caDir)} >> ${shellEscape(logFile)} 2>&1 & echo $!`
  const launchRes = await executeSSH(connectionId, nodeIp, launch)
  if (!launchRes.success) throw new Error(`failed to launch nbdkit nbd reader: ${launchRes.error || launchRes.output}`)
  let ready = false
  for (let i = 0; i < maxAttempts; i++) {
    const check = await executeSSH(connectionId, nodeIp, `test -S ${shellEscape(t.sock)} && echo EXISTS`)
    if (check.output?.includes("EXISTS")) { ready = true; break }
    if (intervalMs > 0) await new Promise(r => setTimeout(r, intervalMs))
  }
  if (!ready) {
    const log = await executeSSH(connectionId, nodeIp, `cat ${shellEscape(logFile)} 2>/dev/null | tail -n 20`)
    // No device was attached yet, so pass nbdDev:"" - teardown must not
    // `nbd-client -d` a device this reader never owned.
    await stopXapiReader(connectionId, nodeIp, { nbdDev: "", sock: t.sock, logFile, caDir }).catch(() => {})
    throw new Error(`nbdkit nbd socket never appeared. nbdkit log: ${log.output?.trim() || "(empty)"}`)
  }
  const connect = await executeSSH(connectionId, nodeIp, buildNbdConnectCmd(t.sock))
  const nbdDev = (connect.output ?? "").split("\n").map(l => l.trim()).find(l => l.startsWith("NBD_DEV="))?.slice("NBD_DEV=".length).trim() ?? ""
  if (!connect.success || !nbdDev) {
    const log = await executeSSH(connectionId, nodeIp, `cat ${shellEscape(logFile)} 2>/dev/null | tail -n 40`)
    await stopXapiReader(connectionId, nodeIp, { nbdDev, sock: t.sock, logFile, caDir }).catch(() => {})
    throw new Error(`nbd-client failed to attach a free NBD device: ${(connect.output || connect.error || "").trim()} | nbdkit log: ${log.output?.trim() || "(empty)"}`)
  }
  return { nbdDev, sock: t.sock, logFile, caDir }
}

/**
 * Tear down a reader started by startXapiReader. Best-effort; safe to call
 * twice. There is no password file on this path, so pwFile is the empty string:
 * buildReaderTeardownCmd filters falsy paths out of its `rm -f` list, so nothing
 * unintended is removed. The pinned-CA directory is removed in the same command
 * (`rm -rf` needs a directory, which the shared `rm -f` file list cannot do).
 */
export async function stopXapiReader(connectionId: string, nodeIp: string, h: XapiReaderHandle): Promise<void> {
  const teardown = buildReaderTeardownCmd({ nbdDev: h.nbdDev, sock: h.sock, pwFile: "", logFile: h.logFile })
  await executeSSH(connectionId, nodeIp, `${teardown}; rm -rf ${shellEscape(h.caDir)}`)
}

/** nbdinfo --map --json entry; `type` bit 1 (value 2) is NBD_STATE_ZERO. */
interface NbdMapEntry { offset: number; length: number; type: number }

/**
 * Keep only the extents that actually carry data: entries flagged
 * NBD_STATE_ZERO are skipped (a HOLE without ZERO is still copied, it may read
 * back as data), entries past EOF are dropped and a trailing entry is clamped
 * to the disk length.
 */
export function parseAllocatedExtents(json: string, diskBytes: number): Extent[] {
  const entries = JSON.parse(json) as NbdMapEntry[]
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("empty map")
  return entries.filter(e => (Number(e.type) & 2) === 0 && e.offset < diskBytes)
    .map(e => ({ offset: Number(e.offset), length: Math.min(Number(e.length), diskBytes - Number(e.offset)) }))
}

/** Allocated map of the export behind `sock`; falls back to the whole disk when the map is unavailable. */
export async function readAllocatedExtents(connectionId: string, nodeIp: string, sock: string, diskBytes: number): Promise<Extent[]> {
  const res = await executeSSH(connectionId, nodeIp, `nbdinfo --map --json ${shellEscape(`nbd+unix:///?socket=${sock}`)}`, 120_000)
  try { if (!res.success) throw new Error(res.error || "nbdinfo failed"); return parseAllocatedExtents(res.output || "", diskBytes) }
  catch { return [{ offset: 0, length: diskBytes }] }
}
