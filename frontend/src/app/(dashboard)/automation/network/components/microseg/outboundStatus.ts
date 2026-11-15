import { zoneEgress, type MicrosegFlow, type MicrosegZone } from '@/lib/microseg/types'

/** What the outbound traffic of the source zone does with a flow to an address outside the zones. */
export type OutboundFlowStatus = 'applied' | 'observed' | 'notApplied'

/**
 * A flow to a CIDR is applied when the zone that emits it enforces its outbound traffic, observed when that zone only
 * observes it, and not applied otherwise (outbound off, a disabled zone, a source that is no zone).
 */
export function outboundFlowStatus(_flow: MicrosegFlow, srcZone: MicrosegZone | undefined): OutboundFlowStatus {
  const egress = srcZone ? zoneEgress(srcZone) : 'off'
  if (egress === 'enforce') return 'applied'
  return egress === 'observe' ? 'observed' : 'notApplied'
}
