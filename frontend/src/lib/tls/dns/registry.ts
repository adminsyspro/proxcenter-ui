// src/lib/tls/dns/registry.ts
//
// Provider id (catalog.ts) to implementation. Server side only.

import type { DnsProviderId } from '@/lib/tls/dns/catalog'
import { createAcmeDnsProvider } from '@/lib/tls/dns/providers/acmedns'
import { createPowerDnsProvider } from '@/lib/tls/dns/providers/powerdns'
import { createRfc2136Provider } from '@/lib/tls/dns/providers/rfc2136'
import type { DnsProviderFactory } from '@/lib/tls/dns/types'

export const DNS_PROVIDER_FACTORIES: Record<DnsProviderId, DnsProviderFactory> = {
  powerdns: createPowerDnsProvider,
  rfc2136: createRfc2136Provider,
  acmedns: createAcmeDnsProvider,
}
