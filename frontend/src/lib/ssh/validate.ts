/**
 * Defensive validators for values that flow into shell command strings
 * executed via executeSSH/executeSSHDirect.
 *
 * Route handlers must NEVER interpolate a URL segment, query param, or
 * request body field directly into a shell command. Use these helpers to
 * either constrain the input to a known-safe shape (assertVmid,
 * assertNodeName) or to escape arbitrary strings via shellEscape from
 * @/lib/ssh/exec.
 */

const NODE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
const VMID_RE = /^[1-9][0-9]*$/
const STORAGE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

export class InvalidShellArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidShellArgError"
  }
}

/**
 * Validate a Proxmox VMID. Proxmox accepts integers in [100, 999999999]
 * but qm/pct will also accept smaller values, so we just require a
 * positive integer with no leading zeros and a sane upper bound.
 */
export function assertVmid(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new InvalidShellArgError("vmid must be a string or number")
  }

  const s = String(raw)

  if (!VMID_RE.test(s)) {
    throw new InvalidShellArgError(`Invalid vmid: ${JSON.stringify(s)}`)
  }

  const n = Number(s)

  if (!Number.isSafeInteger(n) || n < 1 || n > 999_999_999) {
    throw new InvalidShellArgError(`vmid out of range: ${s}`)
  }

  // Return the value re-derived from the parsed integer (not the original
  // string). For any input that passes VMID_RE this is character-identical to
  // `s`, but routing it through Number() severs the string taint so a value
  // interpolated into a shell command can no longer carry attacker-controlled
  // characters (also satisfies CodeQL js/command-line-injection).
  return String(n)
}

/**
 * Validate a Proxmox node name. PVE node names follow the standard
 * hostname grammar: alphanumeric start, then alphanumeric / dot /
 * underscore / dash, max 63 chars.
 */
export function assertNodeName(raw: unknown): string {
  if (typeof raw !== "string" || !NODE_NAME_RE.test(raw)) {
    throw new InvalidShellArgError(`Invalid node name: ${JSON.stringify(raw)}`)
  }

  
return raw
}

/**
 * Validate a PVE/PBS storage identifier. Same grammar as node names in
 * practice (alphanumeric + dot/underscore/dash).
 */
export function assertStorageName(raw: unknown): string {
  if (typeof raw !== "string" || !STORAGE_NAME_RE.test(raw)) {
    throw new InvalidShellArgError(`Invalid storage name: ${JSON.stringify(raw)}`)
  }

  
return raw
}

/**
 * Validate a PVE network bridge name (vmbr0, bond0, eno1, etc.). Same
 * grammar as node names: alphanumeric start, then alphanumeric / dot /
 * underscore / dash.
 */
export function assertBridgeName(raw: unknown): string {
  if (typeof raw !== "string" || !NODE_NAME_RE.test(raw)) {
    throw new InvalidShellArgError(`Invalid bridge name: ${JSON.stringify(raw)}`)
  }

  
return raw
}

/**
 * Validate an absolute filesystem path that will be interpolated into a
 * shell command. Allows alphanumerics, dot, dash, underscore, slash —
 * rejects quotes, $, backticks, semicolons, spaces, etc.
 */
const ABS_PATH_RE = /^\/[a-zA-Z0-9._/-]{0,4095}$/

export function assertAbsPath(raw: unknown): string {
  if (typeof raw !== "string" || !ABS_PATH_RE.test(raw)) {
    throw new InvalidShellArgError(`Invalid absolute path: ${JSON.stringify(raw)}`)
  }

  
return raw
}

