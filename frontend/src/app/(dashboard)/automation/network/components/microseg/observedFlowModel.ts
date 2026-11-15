import { isAggregateDst, type FlowDirection, type MicrosegEvent, type MicrosegSuggestion, type MicrosegTraffic } from '@/lib/microseg/types'

/**
 * The hourly hits of the window from a source zone into a destination zone with the verdict of the flow, oldest first:
 * what the history holds about an observed flow. The history keeps the zones and the verdict of an event, not its
 * service nor its addresses, so the series covers every service between the two zones (every zone-less source when
 * the source zone is ''). Names compare whatever the case; a bucket outside the window is dropped.
 *
 * `dstZone` is the zone of the guest that logged the flow and `srcZone` the other end: for an outbound flow (`direction`
 * 'out') the emitting zone and the destination zone, in that order. A bucket without direction is inbound.
 */
export function flowTrafficSeries(
  traffic: Pick<MicrosegTraffic, 'buckets' | 'from' | 'to' | 'step'>, dstZone: string, srcZone: string, verdict: string, direction: FlowDirection = 'in',
): number[] {
  const from = Date.parse(traffic.from)
  const stepMs = Math.max(1, traffic.step) * 1000
  const size = Math.max(0, Math.round((Date.parse(traffic.to) - from) / stepMs))
  const out = new Array<number>(size).fill(0)
  const dst = dstZone.toLowerCase()
  const src = srcZone.toLowerCase()
  for (const b of traffic.buckets) {
    if (b.zone.toLowerCase() !== dst || (b.src_zone ?? '').toLowerCase() !== src || b.verdict !== verdict || (b.direction ?? 'in') !== direction) continue
    const i = Math.floor((Date.parse(b.at) - from) / stepMs)
    if (i >= 0 && i < size) out[i] += b.hits
  }
  return out
}

/**
 * True when an event of the engine's memory belongs to the observed flow: same direction, verdict, protocol and port.
 * Inbound: into the destination zone, from the source zone (by name) or, for a zone-less source, from its address.
 * Outbound: out of the emitting zone, to the destination zone (by name), or to the destination address when it is in no
 * zone (any address for many destinations).
 */
export function eventOfFlow(e: MicrosegEvent, s: MicrosegSuggestion, srcZone: string, dstZone: string): boolean {
  const out = s.direction === 'out'
  if ((e.direction ?? 'in') !== (out ? 'out' : 'in')) return false
  if (e.verdict !== s.kind || e.proto.toLowerCase() !== s.proto.toLowerCase() || String(e.dport) !== String(s.dport)) return false
  if (out) {
    if (e.zone.toLowerCase() !== srcZone.toLowerCase()) return false
    if (dstZone) return e.src_zone.toLowerCase() === dstZone.toLowerCase()
    return isAggregateDst(s) || e.dst_ip === s.dst_ip
  }
  if (e.zone.toLowerCase() !== dstZone.toLowerCase()) return false
  return s.src_zone_id ? e.src_zone.toLowerCase() === srcZone.toLowerCase() : !e.src_zone && e.src_ip === s.src_ip
}
