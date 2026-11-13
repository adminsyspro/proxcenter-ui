/**
 * Recognise an SSH failure caused by the host key: a key that is not
 * confirmed yet, or that differs from the trusted one. Both are fixed by
 * confirming the key (connection SSH test, or Settings > SSH commands > Host
 * keys), unlike an auth, timeout or network failure.
 *
 * The orchestrator and the Node side word it the same way ("ssh host key of
 * <host:port> changed" / "is not confirmed"); the older "host key mismatch"
 * wording is still recognised for an orchestrator not yet upgraded.
 */
const HOST_KEY_REFUSAL = /host[\s_-]?key\s+mismatch|host key of \S+ (?:changed|is not confirmed)/i

export function isHostKeyMismatch(error?: string): boolean {
  if (!error) return false

  return HOST_KEY_REFUSAL.test(error)
}
