import { Client } from "ssh2"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { safeLog } from "@/lib/log/sanitize"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { makeHostVerifier } from "@/lib/ssh/host-key-store"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

/**
 * Escape a string for safe use as a shell argument.
 * Wraps in single quotes and escapes embedded single quotes.
 */
export function shellEscape(arg: string): string {
  return "'" + arg.replaceAll("'", "'\\''") + "'"
}

export interface SSHResult {
  success: boolean
  output?: string
  error?: string
}

// Keepalive on every ssh2 connection: send a probe every 15s and give up after
// 4 unanswered probes (~60s). A plain `dd` copy emits nothing for hours, so its
// SSH control channel sits idle and a NAT/firewall (e.g. an inter-site IPsec link)
// silently drops the session; with no keepalive ssh2 neither keeps it warm nor
// notices the drop, so the call hangs to the absolute cap (12h) before failing.
// Keepalives keep the session warm AND surface a dead link as a fast
// `conn.on('error')` instead of a multi-hour hang (adminsyspro/proxcenter-ui#445).
const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 4

/** Optional per-call streaming/inactivity controls for executeSSH(Direct). */
export interface SSHExecOpts {
  /** Fail the command if no stdout/stderr byte arrives for this long. Pair with a
   *  command that emits progress (e.g. `dd status=progress`) so a genuinely stalled
   *  transfer fails fast while a moving one is never cut off. Off when unset. */
  inactivityMs?: number
  /** Called with each stdout/stderr chunk as it streams (e.g. to log live dd
   *  progress). Only honoured on the ssh2 path. */
  onData?: (chunk: string) => void
}

/**
 * Build the ssh2 connect config, with keepalive always on (see the constants
 * above) and TOFU host-key verification. Auth is key (+ optional passphrase) or
 * password (+ keyboard-interactive), matching what the connection record holds.
 */
export function buildConnectConfig(opts: {
  host: string; port: number; user: string; key?: string; password?: string; passphrase?: string
}): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    host: opts.host,
    port: opts.port,
    username: opts.user,
    readyTimeout: 30_000,
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
    // TOFU host-key verification. Pin on first contact, refuse any later
    // connection whose server key differs. Closes the MITM gap that ssh2's
    // default "trust everything" behaviour leaves open.
    hostVerifier: makeHostVerifier(opts.host, opts.port),
  }
  if (opts.key) {
    cfg.privateKey = opts.key
    if (opts.passphrase) cfg.passphrase = opts.passphrase
  }
  if (opts.password) {
    cfg.password = opts.password
    cfg.tryKeyboard = true
  }
  return cfg
}

/**
 * True when a thrown value is an AbortSignal.timeout() abort. `AbortSignal.timeout`
 * rejects the fetch with a DOMException named "TimeoutError" (some runtimes:
 * "AbortError"). On such a timeout the orchestrator may have already started, or
 * finished, the command, so the caller must NOT silently re-run it over ssh2 —
 * that risks a second multi-hour operation (#445). Genuine connection failures
 * (TypeError "fetch failed", ECONNREFUSED) return false → fall back to ssh2.
 */
export function isOrchestratorTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name
  return name === "TimeoutError" || name === "AbortError"
}

/**
 * A resettable inactivity timer. Armed on creation; `bump()` restarts the
 * countdown (call it on every byte of activity), `clear()` cancels it, and
 * `onFire` runs once if the full interval elapses without a bump.
 */
export function createInactivityTimer(ms: number, onFire: () => void): { bump: () => void; clear: () => void } {
  let handle: ReturnType<typeof setTimeout> | null = null
  const bump = () => {
    if (handle) clearTimeout(handle)
    handle = setTimeout(onFire, ms)
  }
  const clear = () => {
    if (handle) { clearTimeout(handle); handle = null }
  }
  bump()
  return { bump, clear }
}

/**
 * Execute an SSH command with orchestrator-first, ssh2-fallback strategy.
 *
 * 1. Try the Go orchestrator POST /api/v1/ssh/exec
 * 2. On network error (ECONNREFUSED, fetch failure) → direct ssh2 execution
 */
export async function executeSSH(
  connectionId: string,
  nodeIp: string,
  command: string,
  timeoutMs: number = 30_000,
  execOpts: SSHExecOpts = {}
): Promise<SSHResult> {
  // Load via the global (unscoped) prisma. SSH credentials live on the
  // connection record owned by the provider tenant; a tenant in vDC mode
  // legitimately needs to reach those credentials to run commands on
  // their own VMs (e.g. qm unlock). Authorisation is the caller's job —
  // the route that hits executeSSH must already have verified the
  // tenant's claim on this connection (RBAC permission + vDC scope).
  // Using the tenant-scoped prisma here would silently return null for
  // any cross-tenant lookup and the "SSH not enabled" error would lie
  // about the actual root cause.
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: {
      sshEnabled: true,
      sshPort: true,
      sshUser: true,
      sshAuthMethod: true,
      sshKeyEnc: true,
      sshPassEnc: true,
      sshUseSudo: true,
    },
  })

  if (!connection?.sshEnabled) {
    return { success: false, error: "SSH not enabled for this connection" }
  }

  const port = connection.sshPort || 22
  const user = connection.sshUser || "root"

  // Decrypt credentials based on configured auth method
  let key: string | undefined
  let password: string | undefined
  let passphrase: string | undefined

  const authMethod = connection.sshAuthMethod || (connection.sshKeyEnc ? "key" : "password")

  if (authMethod === "key" && connection.sshKeyEnc) {
    try {
      key = decryptSecret(connection.sshKeyEnc)
    } catch {
      return { success: false, error: "Failed to decrypt SSH key" }
    }
    // Passphrase for key
    if (connection.sshPassEnc) {
      try {
        passphrase = decryptSecret(connection.sshPassEnc)
      } catch {
        // Ignore passphrase decryption errors
      }
    }
  } else if (authMethod === "password" && connection.sshPassEnc) {
    try {
      password = decryptSecret(connection.sshPassEnc)
    } catch {
      return { success: false, error: "Failed to decrypt SSH password" }
    }
  } else {
    // Fallback: try whatever is available
    if (connection.sshKeyEnc) {
      try { key = decryptSecret(connection.sshKeyEnc) } catch {}
    }
    if (connection.sshPassEnc) {
      try {
        const decrypted = decryptSecret(connection.sshPassEnc)
        if (key) passphrase = decrypted
        else password = decrypted
      } catch {}
    }
  }

  // Prefix command with sudo if configured AND the SSH user is not root.
  // The connection-form help text promises this conditional behavior
  // ("Prefix commands with sudo when the SSH user is not root"). Honoring it
  // here matters on Debian 13 / PVE 9, where `sudo` is not installed by
  // default — wrapping a root-user command with `sudo sh -c '...'` would
  // otherwise fail every check with `bash: sudo: command not found`.
  // Use `sudo sh -c '...'` so compound commands (&&, ||, pipes, redirects)
  // all execute under sudo. Naive `sudo cmd1 && cmd2` only sudo's cmd1.
  const needsSudo = connection.sshUseSudo && user !== 'root'
  const finalCommand = needsSudo ? `sudo sh -c ${shellEscape(command)}` : command

  // 1. Try orchestrator
  try {
    const body: Record<string, unknown> = { host: nodeIp, port, user, command: finalCommand }
    if (key) body.key = key
    if (password) body.password = password
    if (passphrase) body.passphrase = passphrase

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ssh/exec`, {
      method: "POST",
      headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (res.ok) {
      const data = await res.json()
      console.log(`[ssh] executed via orchestrator on ${safeLog(nodeIp)}`)
      return { success: data.success !== false, output: data.output, error: data.error }
    }

    const err = await res.json().catch(() => ({}))
    const errMsg = err?.error || res.statusText
    // If orchestrator rejects the command (whitelist), fall through to direct ssh2
    if (errMsg.includes('not allowed') || errMsg.includes('not permitted') || res.status === 403) {
      console.log(`[ssh] orchestrator rejected command, falling back to ssh2 for ${safeLog(nodeIp)}`)
    } else {
      return { success: false, error: errMsg }
    }
  } catch (err) {
    // A fetch timeout (AbortSignal.timeout) is NOT "unreachable": the orchestrator
    // may have already run, or be running, the command. Re-running it over ssh2
    // would risk a second multi-hour operation, so surface the timeout instead of
    // falling through (#445). Only a genuine connection failure falls back.
    if (isOrchestratorTimeoutError(err)) {
      return { success: false, error: `orchestrator SSH timeout (${Math.round(timeoutMs / 1000)}s)` }
    }
    // Orchestrator unreachable – fall through to ssh2
    console.log(`[ssh] orchestrator unavailable, falling back to ssh2 for ${safeLog(nodeIp)}`)
  }

  // 2. Fallback: direct ssh2
  return executeSSHDirect({
    host: nodeIp, port, user, key, password, passphrase, command: finalCommand, timeoutMs,
    inactivityMs: execOpts.inactivityMs, onData: execOpts.onData,
  })
}

/**
 * Execute a command over SSH using the ssh2 library directly.
 */
export function executeSSHDirect(opts: {
  host: string
  port: number
  user: string
  key?: string
  password?: string
  passphrase?: string
  command: string
  timeoutMs?: number
  inactivityMs?: number
  onData?: (chunk: string) => void
}): Promise<SSHResult> {
  return new Promise((resolve) => {
    const conn = new Client()
    // Absolute cap for the whole SSH operation (connect + exec + stream).
    // Long-running commands (e.g. multi-GB dd writes) pass a large timeoutMs;
    // falls back to 30s for plain execs. This is the backstop — the keepalive
    // (buildConnectConfig) and the optional inactivity guard catch a dead/stalled
    // transfer long before this fires.
    const overallTimeoutMs = opts.timeoutMs ?? 30_000

    // Single-settle guard: whichever of close/error/timeout/inactivity happens
    // first wins and tears down both timers + the connection.
    let settled = false
    let inactivity: { bump: () => void; clear: () => void } | null = null
    const settle = (r: SSHResult) => {
      if (settled) return
      settled = true
      clearTimeout(absTimeout)
      inactivity?.clear()
      conn.end()
      resolve(r)
    }

    const absTimeout = setTimeout(
      () => settle({ success: false, error: `SSH connection timeout (${Math.round(overallTimeoutMs / 1000)}s)` }),
      overallTimeoutMs,
    )
    if (opts.inactivityMs && opts.inactivityMs > 0) {
      const ims = opts.inactivityMs
      inactivity = createInactivityTimer(ims, () =>
        settle({ success: false, error: `SSH inactivity timeout (${Math.round(ims / 1000)}s with no output)` }),
      )
    }

    conn.on("ready", () => {
      // codeql[js/command-line-injection] — commands are built server-side, not from direct user input
      conn.exec(opts.command, (err, stream) => {
        if (err) {
          settle({ success: false, error: err.message })
          return
        }

        let stdout = ""
        let stderr = ""
        // Any byte of output is "activity": reset the inactivity guard and
        // forward the chunk to the live-progress callback (if any).
        const onChunk = (s: string) => {
          inactivity?.bump()
          opts.onData?.(s)
        }

        stream.on("data", (data: Buffer) => {
          const s = data.toString()
          stdout += s
          onChunk(s)
        })
        stream.stderr.on("data", (data: Buffer) => {
          const s = data.toString()
          stderr += s
          onChunk(s)
        })
        stream.on("close", (code: number) => {
          if (code === 0 || code === null) {
            console.log(`[ssh] executed via ssh2 on ${safeLog(opts.host)}`)
            settle({ success: true, output: stdout.trim(), error: stderr.trim() || undefined })
          } else {
            // Preserve stdout on non-zero exit so callers can surface full
            // script output in error diagnostics. Previously stdout was
            // discarded and we only returned stderr or "Exit code N", which
            // blinded us when a script redirected stderr to stdout with 2>&1.
            settle({ success: false, output: stdout.trim(), error: stderr.trim() || `Exit code ${code}` })
          }
        })
      })
    })

    conn.on("error", (err) => settle({ success: false, error: err.message }))

    // Handle keyboard-interactive auth (used by ESXi and some other hosts)
    conn.on("keyboard-interactive", (_name, _instructions, _instructionsLang, prompts, finish) => {
      if (opts.password && prompts.length > 0) {
        finish([opts.password])
      } else {
        finish([])
      }
    })

    conn.connect(buildConnectConfig(opts) as any)
  })
}
