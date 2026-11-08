/**
 * Host key checking for the SSH sessions a migration opens from a Proxmox
 * node to the source ESXi host (OpenSSH, sshpass, SSHFS, QEMU's ssh driver,
 * virt-v2v and its nbdkit/libssh transport).
 *
 * The node never trusts the key it is shown: the keys confirmed in ProxCenter
 * for the ESXi endpoint (the SSH test of the connection) are written to a
 * known_hosts file on the node and every client is told to check against it.
 * Without a confirmed key the migration stops before any credential leaves
 * ProxCenter.
 */
import { hostKeyEndpoint, trustedKnownHosts } from "@/lib/ssh/host-key-store"

/** No key of the ESXi endpoint is confirmed: nothing was sent to the host. */
export class EsxiHostKeyNotTrustedError extends Error {
  readonly endpoint: string

  constructor(endpoint: string) {
    super(
      `The SSH host key of the ESXi host ${endpoint} is not confirmed in ProxCenter. ` +
      "Run the SSH test of the ESXi connection (Settings > Connections), compare the fingerprint it shows " +
      "with the one the host reports, trust it, then start the migration again. No credential was sent to the host."
    )
    this.name = "EsxiHostKeyNotTrustedError"
    this.endpoint = endpoint
  }
}

export interface EsxiHostTrust {
  /** "host:port", as the host key registry keys it. */
  endpoint: string
  /** known_hosts file on the Proxmox node (stageEsxiKnownHosts writes it). */
  file: string
  /** Its content, one line per confirmed key. */
  lines: string[]
  keyTypes: string[]
  /** SHA-256 of each key (hex), in the order of keyTypes. */
  sha256Hex: string[]
}

// Paths are built from fixed prefixes and job ids; anything else would need
// quoting in the sshfs -o list and in ssh_config, where no quoting exists.
const SAFE_PATH = /^\/[A-Za-z0-9_./-]+$/

function assertSafePath(file: string): void {
  if (!SAFE_PATH.test(file)) throw new Error(`unsafe known_hosts path: ${file}`)
}

/**
 * The confirmed keys of the ESXi SSH endpoint, to be written to `file` on the
 * node. Throws EsxiHostKeyNotTrustedError when none is confirmed.
 */
export async function loadEsxiHostTrust(host: string, port: number, file: string): Promise<EsxiHostTrust> {
  assertSafePath(file)
  const endpoint = hostKeyEndpoint(host, port)
  const { lines, keyTypes, sha256Hex } = await trustedKnownHosts(host, port)
  if (lines.length === 0) throw new EsxiHostKeyNotTrustedError(endpoint || `${host}:${port}`)

  return { endpoint, file, lines, keyTypes, sha256Hex }
}

/** Command and stdin that write the known_hosts file on the node (0600). */
export function stageEsxiKnownHosts(trust: EsxiHostTrust): { command: string; stdin: string } {
  return { command: `umask 077; cat > '${trust.file}'`, stdin: `${trust.lines.join("\n")}\n` }
}

// The three forms below take the file path rather than the loaded trust so a
// command can be assembled before loadEsxiHostTrust runs; the caller still
// stages the file (and so checks a key is confirmed) before running it.

/** OpenSSH/sshpass options: check the host key against the file only. */
export function esxiStrictSshOptions(file: string): string {
  assertSafePath(file)
  return `-o StrictHostKeyChecking=yes -o UserKnownHostsFile=${file}`
}

/** The same, as sshfs -o items (comma separated, no quoting). */
export function esxiStrictSshfsOptions(file: string): string {
  assertSafePath(file)
  return `StrictHostKeyChecking=yes,UserKnownHostsFile=${file}`
}

/** The same, as ssh_config lines (virt-v2v's per-job config). */
export function esxiStrictSshConfigLines(file: string): string[] {
  assertSafePath(file)
  return ["    StrictHostKeyChecking yes", `    UserKnownHostsFile ${file}`]
}

// What OpenSSH, sshfs and libssh print when the host key is not the one in
// the known_hosts file they were given.
const HOST_KEY_FAILURE = /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|host key for \S+ has changed|No \S+ host key is known|host key (?:is unknown|mismatch)/i

/**
 * The explanation to give when an ESXi SSH session failed on the host key,
 * read from the client output; null for any other failure.
 */
export function esxiHostKeyFailure(endpoint: string, ...outputs: (string | undefined | null)[]): string | null {
  if (!outputs.some(o => o && HOST_KEY_FAILURE.test(o))) return null

  return `The ESXi host ${endpoint} presented an SSH host key that is not the one confirmed in ProxCenter: ` +
    "the connection was refused before any credential was sent. If the host was reinstalled, run the SSH test " +
    "of the ESXi connection and trust its new key; otherwise another machine may be answering for it."
}

/**
 * A login attempt that carries no credential (no key, no password, batch
 * mode) but checks the host key strictly: it fails on "Permission denied"
 * when the host is the one confirmed, and on "Host key verification failed"
 * otherwise. Run once the known_hosts file is staged, before any secret is.
 * The leading `ssh -i` matches the orchestrator allowlist.
 */
export function esxiHostKeyProbeCommand(file: string, user: string, host: string, port: number): string {
  const login = `${user}@${host}`.replaceAll("'", `'\\''`)

  return `ssh -i /dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o PreferredAuthentications=publickey ${esxiStrictSshOptions(file)} ` +
    `-o ConnectTimeout=15 -o HostKeyAlgorithms=+ssh-rsa -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 ` +
    `-p ${Math.trunc(port)} '${login}' true 2>&1`
}

/** How known_hosts names the endpoint: "host" on port 22, "[host]:port" otherwise. */
export function knownHostsNames(host: string, port: number): string[] {
  return [port === 22 ? host : `[${host}]:${port}`]
}

/** The SSH host of an ESXi connection: the hostname of its API URL. */
export function esxiSshHost(baseUrl: string): string {
  let host = ""
  try {
    host = new URL(baseUrl).hostname.replace(/^\[(.*)\]$/, "$1")
  } catch {
    // Not a URL: read it as host[:port][/path] below.
  }

  return host || baseUrl.replace(/^https?:\/\//, "").split("/")[0].replace(/:\d+$/, "")
}

// libssh's own preference among host key types: the key QEMU's ssh driver
// will meet when the host holds several.
const LIBSSH_ORDER = ["ssh-ed25519", "ecdsa-sha2-nistp521", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp256", "ssh-rsa"]

/**
 * QEMU ssh driver options (`file.` prefix included) that check the host key
 * by its SHA-256 hash. QEMU takes a single hash: that of the confirmed key
 * libssh negotiates first.
 */
export function qemuHostKeyCheck(trust: EsxiHostTrust): Record<string, string> {
  const rank = (t: string) => {
    const i = LIBSSH_ORDER.indexOf(t)
    return i < 0 ? LIBSSH_ORDER.length : i
  }
  let best = 0
  trust.keyTypes.forEach((t, i) => {
    if (rank(t) < rank(trust.keyTypes[best])) best = i
  })

  return {
    "file.host-key-check.mode": "hash",
    "file.host-key-check.type": "sha256",
    "file.host-key-check.hash": trust.sha256Hex[best],
  }
}

/** The QEMU options above as a -drive option string. */
export function qemuHostKeyCheckOption(trust: EsxiHostTrust): string {
  return Object.entries(qemuHostKeyCheck(trust)).map(([k, v]) => `${k}=${v}`).join(",")
}
