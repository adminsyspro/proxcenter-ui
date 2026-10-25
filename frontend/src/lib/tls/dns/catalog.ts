// src/lib/tls/dns/catalog.ts
//
// The DNS providers DNS-01 can drive, described as data. Imported by the
// settings form (to draw the fields), by the schema (to validate them) and by
// the API (to know which fields are secrets). No server code here: this file
// ships to the browser.

export type DnsFieldKind = 'text' | 'secret' | 'select'

export interface DnsProviderField {
  key: string
  kind: DnsFieldKind
  required: boolean
  /** Only for `select`. The first entry is the default. */
  options?: readonly string[]
  /** Pre-filled value for an optional text field, shown as the placeholder. */
  placeholder?: string
  /** The name alone can be misread: the form shows `settings.tls.dns.hints.<key>` in a tooltip. */
  hint?: boolean
}

export interface DnsProviderDescriptor {
  id: string
  label: string
  fields: readonly DnsProviderField[]
  /** Where the operator creates the credential the fields ask for. */
  docsUrl: string
}

export const DNS_PROVIDERS = [
  {
    id: 'powerdns',
    label: 'PowerDNS',
    fields: [
      { key: 'apiUrl', kind: 'text', required: true, placeholder: 'http://pdns.example.com:8081' },
      { key: 'apiKey', kind: 'secret', required: true },
      { key: 'serverId', kind: 'text', required: false, placeholder: 'localhost', hint: true },
    ],
    docsUrl: 'https://doc.powerdns.com/authoritative/http-api/index.html',
  },
  {
    id: 'rfc2136',
    label: 'RFC 2136 (nsupdate, BIND)',
    fields: [
      { key: 'server', kind: 'text', required: true, placeholder: 'ns1.example.com:53' },
      { key: 'keyName', kind: 'text', required: true },
      { key: 'keyAlgorithm', kind: 'select', required: true, options: ['hmac-sha256', 'hmac-sha512', 'hmac-sha384', 'hmac-sha224', 'hmac-sha1'] },
      { key: 'keySecret', kind: 'secret', required: true },
      { key: 'zone', kind: 'text', required: false, hint: true },
    ],
    docsUrl: 'https://bind9.readthedocs.io/en/latest/manpages.html#nsupdate-dynamic-dns-update-utility',
  },
  {
    id: 'acmedns',
    label: 'acme-dns',
    fields: [
      { key: 'apiUrl', kind: 'text', required: true, placeholder: 'https://auth.acme-dns.io' },
      { key: 'username', kind: 'text', required: true },
      { key: 'password', kind: 'secret', required: true },
      { key: 'subdomain', kind: 'text', required: true, hint: true },
    ],
    docsUrl: 'https://github.com/joohoi/acme-dns#usage',
  },
] as const satisfies readonly DnsProviderDescriptor[]

export type DnsProviderId = (typeof DNS_PROVIDERS)[number]['id']

export const DNS_PROVIDER_IDS = DNS_PROVIDERS.map(p => p.id) as [DnsProviderId, ...DnsProviderId[]]

export function findDnsProvider(id: string): DnsProviderDescriptor | undefined {
  return DNS_PROVIDERS.find(p => p.id === id)
}

export function secretFieldKeys(id: string): string[] {
  return (findDnsProvider(id)?.fields ?? []).filter(f => f.kind === 'secret').map(f => f.key)
}

/** Propagation is checked against the authoritative servers; this wait comes on top, as on Proxmox. */
export const DEFAULT_DNS_VALIDATION_DELAY_S = 30
export const MAX_DNS_VALIDATION_DELAY_S = 600
