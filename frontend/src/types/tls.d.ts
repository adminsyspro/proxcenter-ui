export {}

declare global {
  // The HTTPS listener lives in start.js, which is CommonJS outside the Next
  // bundle; this is the contract the bundled code (src/lib/tls/bootstrap.ts)
  // drives it through. `state()` echoes back everything that decides the
  // served configuration, because that is what the reconciler compares against
  // the database on every tick. `servedFingerprint` covers the whole bundle
  // handed to the secure context, not just the leaf: intermediates often
  // arrive inside the certificate field with no separate chain at all.
  var __proxcenterTls: {
    start(o: {
      port: number
      certPem: string
      chainPem: string | null
      keyPem: string
      minVersion: 'TLSv1.2' | 'TLSv1.3'
      fingerprint: string
      servedFingerprint: string
    }): Promise<void>
    reload(o: {
      certPem: string
      chainPem: string | null
      keyPem: string
      fingerprint: string
      servedFingerprint: string
    }): void
    stop(): Promise<void>
    setHttpPolicy(p: { redirect: boolean; httpsPublicPort: number; hstsHeader: string | null }): void
    state(): {
      listening: boolean
      port: number | null
      fingerprint: string | null
      servedFingerprint: string | null
      minVersion: 'TLSv1.2' | 'TLSv1.3' | null
    }
  } | undefined
}
