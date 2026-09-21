/**
 * Recognise the one SSH failure an operator can fix from the UI: a pinned host
 * key that no longer matches the key the node presents.
 *
 * ProxCenter pins the host key of every node on first contact, so a node that
 * was reinstalled or rekeyed is refused for ever after with
 *
 *   ssh host-key mismatch for "10.42.0.101": pinned ecdsa-sha2-nistp256,
 *   presented ecdsa-sha2-nistp256. Refusing to connect.
 *
 * Only that failure gets a "Re-trust" button: every other SSH error (auth,
 * timeout, unreachable) is not cured by dropping the pin, and offering to drop
 * it would teach the operator to clear pins whenever anything goes wrong.
 *
 * The orchestrator and the Node side of the app word the message slightly
 * differently ("host-key mismatch" vs "host key mismatch"), hence the loose
 * separator.
 */
const HOST_KEY_MISMATCH = /host[\s_-]?key\s+mismatch/i

export function isHostKeyMismatch(error?: string): boolean {
  if (!error) return false
  return HOST_KEY_MISMATCH.test(error)
}
