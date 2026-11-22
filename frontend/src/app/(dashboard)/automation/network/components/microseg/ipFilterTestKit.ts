/** Shared fixtures of the IP filter tests: a row of GET /ipfilter and its answer. */

import type { IPFilterGuest, MicrosegIPFilter } from '@/lib/microseg/types'

export const filterGuest = (over: Partial<IPFilterGuest> = {}): IPFilterGuest => ({
  node: 'pve1', type: 'qemu', vmid: 100, name: 'web-1', zone: 'web', mode: 'on', applied: true,
  nics: { net0: ['0.0.0.0', '10.0.0.5', 'fe80::be24:11ff:fe00:64'] },
  held: [], no_address: [], manual: [], dhcp: [], unknown: [], extra: [], ...over,
})

export const filterAnswer = (guests: IPFilterGuest[] = [filterGuest()], over: Partial<MicrosegIPFilter> = {}): MicrosegIPFilter => ({
  enabled: true, computed: true, computed_at: '2026-11-20T10:00:00Z', guests, ...over,
})
