/**
 * Parse the SHA1 certificate fingerprint from `openssl x509 -fingerprint -sha1`
 * output. The fingerprint is the `thumbprint=` value nbdkit-vddk needs to
 * authenticate the ESXi/vCenter TLS connection. The full command run on the PVE
 * node is:
 *   openssl s_client -connect <host>:443 </dev/null 2>/dev/null \
 *     | openssl x509 -fingerprint -sha1 -noout
 * which prints e.g. `SHA1 Fingerprint=46:8C:45:...`. Throws if no fingerprint
 * line is present (TLS handshake failed, wrong host, etc.).
 */
export function parseSha1Thumbprint(opensslOut: string): string {
  const m = opensslOut.match(/Fingerprint=([0-9A-Fa-f:]+)/i)
  if (!m) throw new Error("could not parse SHA1 thumbprint from openssl output")
  return m[1].trim()
}
