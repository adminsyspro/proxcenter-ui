// SHA1 thumbprint of the certificate the VDDK will be shown (roadmap#175).
//
// nbdkit-vddk authenticates the TLS connection to the ESXi host or vCenter by
// the `thumbprint=` of its certificate, so the thumbprint is read from the
// Proxmox node itself, from the address the VDDK will dial. Any certificate
// does, self-signed or from an internal PKI: `openssl s_client` prints it
// whatever the verification verdict. What fails is the connection (name not
// resolvable from the node, port closed or filtered, no route) or the TLS
// handshake, and the node's own OpenSSL says which: its messages are kept and
// turned into a sentence the operator can act on, instead of an empty output.

import { shellEscape } from "@/lib/ssh/exec"
import { bareHost, isValidCopyAddress } from "./nfc-reachability"

export const THUMBPRINT_TIMEOUT_SEC = 15

/** Twenty colon-separated octets, as `openssl x509 -fingerprint -sha1` prints them. */
const FINGERPRINT_RE = /Fingerprint=((?:[0-9A-F]{2}:){19}[0-9A-F]{2})\b/i
const EXIT_RE = /^s_client-exit=(\d+)$/m

/**
 * `openssl s_client` with stderr kept: prints the `SHA1 Fingerprint=` line
 * when a certificate came back, else `s_client-exit=<code>` and the OpenSSL
 * error lines. Bounded, since a filtered port would otherwise hang until the
 * TCP connect gives up.
 */
export function buildThumbprintCmd(host: string, port = 443): string {
  const h = bareHost(host)
  if (!isValidCopyAddress(h)) throw new Error(`Invalid VMware address: ${JSON.stringify(host)}`)
  const target = h.includes(":") ? `[${h}]:${port}` : `${h}:${port}`
  return `out=$(echo | timeout ${THUMBPRINT_TIMEOUT_SEC} openssl s_client -connect ${shellEscape(target)} 2>&1); rc=$?; `
    + `printf '%s\\n' "$out" | openssl x509 -fingerprint -sha1 -noout 2>/dev/null || { echo "s_client-exit=$rc"; `
    + `printf '%s\\n' "$out" | grep -iE 'error|errno|refused|unreachable|no route|lookup|not known|name resolution|no peer certificate' | head -n 5; }`
}

/** Why no certificate came back, from the s_client exit code and messages. */
function describeFailure(output: string, host: string, port: number): string {
  const exit = Number(EXIT_RE.exec(output)?.[1] ?? NaN)
  // "80D7A3F2BD7E0000:error:0A00010B:SSL routines:...": the thread and code prefix says nothing to an operator.
  const detail = output.split("\n").map(l => l.trim()).find(l => /error|errno/i.test(l))?.replace(/^[0-9A-F]+:error:[0-9A-F]+:/i, "")
  if (exit === 124) {
    return `no answer from ${host} on port ${port} within ${THUMBPRINT_TIMEOUT_SEC} s: a firewall between the node and ${host} drops the connection`
  }
  if (/BIO_lookup|not known|name resolution|No address associated/i.test(output)) {
    return `the node cannot resolve the name ${host}: add it to the node's DNS or /etc/hosts`
  }
  if (/refused/i.test(output)) return `${host} refused the connection on port ${port}: open the firewall from the node to ${host}`
  if (/no route|unreachable/i.test(output)) return `the node has no route to ${host}: route the node to that network`
  if (detail) return `TLS handshake with ${host}:${port} failed (${detail})`
  return `${host}:${port} presented no certificate`
}

/**
 * Thumbprint from the output of buildThumbprintCmd, upper-case. Throws a
 * sentence naming the address, the node and the cause when there is none.
 */
export function parseThumbprintProbe(output: string | undefined, host: string, node: string, port = 443): string {
  const out = output ?? ""
  const m = FINGERPRINT_RE.exec(out)
  if (m) return m[1].toUpperCase()
  throw new Error(`Could not read the TLS certificate of ${host}:${port} from the Proxmox node ${node}, which the VDDK needs to connect: ${describeFailure(out, host, port)}`)
}
