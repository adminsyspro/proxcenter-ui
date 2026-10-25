// src/lib/tls/dns/providers/acmedns.ts
//
// acme-dns (joohoi/acme-dns) with the account returned by its /register call.
// The operator CNAMEs `_acme-challenge.<domain>` to `<subdomain>.<acme-dns
// zone>` once, so the name ACME asks for is never written here: every value
// goes to the account's subdomain.
//
// acme-dns serves only the last TWO values written to a subdomain, the newest
// replacing the oldest. That covers a wildcard and its apex (two values at one
// name), not more: an order with three or more names behind the same account
// pushes the first value out before it is validated. It has no delete either;
// values age out as new ones arrive.

import { DnsProviderError, type DnsProviderFactory } from '@/lib/tls/dns/types'
import { dnsHttp, requireField } from '@/lib/tls/dns/util'

const LABEL = 'acme-dns'

function apiRoot(raw: string): string {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new DnsProviderError(`${LABEL}: the API URL is not a valid URL`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DnsProviderError(`${LABEL}: the API URL must start with http:// or https://`)

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export const createAcmeDnsProvider: DnsProviderFactory = (credentials, { fetch }) => {
  const root = apiRoot(requireField(credentials, 'apiUrl', LABEL))
  const username = requireField(credentials, 'username', LABEL)
  const password = requireField(credentials, 'password', LABEL)
  const subdomain = requireField(credentials, 'subdomain', LABEL)

  return {
    // `fqdn` is ignored: the CNAME decides where the value is served.
    async addTxtRecord(_fqdn, value) {
      await dnsHttp(fetch, LABEL, `${root}/update`, {
        method: 'POST',
        headers: { 'X-Api-User': username, 'X-Api-Key': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, txt: value }),
      })
    },

    // Nothing to remove: acme-dns has no delete and rotates values by itself.
    async removeTxtRecord() {},

    // acme-dns has no read endpoint, so the credentials cannot be proved
    // without writing a value. What can be checked is that the server answers:
    // /health exists on current releases; a 404 still means it is reachable.
    async checkAccess() {
      await dnsHttp(fetch, LABEL, `${root}/health`, { allowStatus: [404] })
    },
  }
}
