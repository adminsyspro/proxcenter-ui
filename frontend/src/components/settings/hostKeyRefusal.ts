/** A host key the SSH test refused, as the orchestrator and the app both report it. */
export interface SshHostKeyRefusal {
  /** "host:port", the endpoint the key is trusted for. */
  endpoint: string
  key_type: string
  fingerprint: string
  /** "unconfirmed": no trusted key yet; "mismatch": a different key is trusted. */
  state: 'unconfirmed' | 'mismatch'
}
