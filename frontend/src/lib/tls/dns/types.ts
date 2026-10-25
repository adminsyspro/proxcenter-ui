// src/lib/tls/dns/types.ts
//
// What every DNS provider implements. A provider only ever touches TXT records
// under `_acme-challenge.`, and only the value it was given: other values at
// the same name belong to someone else (a wildcard and its apex share one name
// with two values, and another ACME client may be mid-order on the same zone).

export interface DnsProvider {
  /**
   * Publish `value` as one more TXT value at `fqdn` (absolute, no trailing
   * dot), leaving any other value at that name in place.
   */
  addTxtRecord(fqdn: string, value: string): Promise<void>

  /** Remove exactly that value. A value already gone is not an error. */
  removeTxtRecord(fqdn: string, value: string): Promise<void>

  /**
   * Prove, without writing anything, that the credentials can manage the zone
   * holding `fqdn`. Throws a DnsProviderError whose message an operator can
   * act on ("no zone found for example.com", "token rejected (HTTP 403)").
   */
  checkAccess(fqdn: string): Promise<void>
}

export interface DnsProviderContext {
  fetch: typeof fetch
}

export type DnsProviderFactory = (credentials: Record<string, string>, context: DnsProviderContext) => DnsProvider

/** An error meant for the operator: its message lands in the order status and the audit log as is. */
export class DnsProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DnsProviderError'
  }
}
