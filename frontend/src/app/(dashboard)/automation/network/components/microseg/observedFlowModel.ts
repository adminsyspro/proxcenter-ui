import type { MicrosegEvent, MicrosegSuggestion, MicrosegTraffic } from '@/lib/microseg/types'

/**
 * The hourly hits of the window from a source zone into a destination zone with the verdict of the flow, oldest first:
 * what the history holds about an observed flow. The history keeps the zones and the verdict of an event, not its
 * service nor its addresses, so the series covers every service between the two zones (every zone-less source when
 * the source zone is ''). Names compare whatever the case; a bucket outside the window is dropped.
 */
export function flowTrafficSeries(
  traffic: Pick<MicrosegTraffic, 'buckets' | 'from' | 'to' | 'step'>, dstZone: string, srcZone: string, verdict: string,
): number[] {
  const from = Date.parse(traffic.from)
  const stepMs = Math.max(1, traffic.step) * 1000
  const size = Math.max(0, Math.round((Date.parse(traffic.to) - from) / stepMs))
  const out = new Array<number>(size).fill(0)
  const dst = dstZone.toLowerCase()
  const src = srcZone.toLowerCase()
  for (const b of traffic.buckets) {
    if (b.zone.toLowerCase() !== dst || (b.src_zone ?? '').toLowerCase() !== src || b.verdict !== verdict) continue
    const i = Math.floor((Date.parse(b.at) - from) / stepMs)
    if (i >= 0 && i < size) out[i] += b.hits
  }
  return out
}

/**
 * True when an event of the engine's memory belongs to the observed flow: same verdict, protocol and port, into the
 * destination zone, from the source zone (by name) or, for a zone-less source, from its address.
 */
export function eventOfFlow(e: MicrosegEvent, s: MicrosegSuggestion, srcZone: string, dstZone: string): boolean {
  if (e.verdict !== s.kind || e.proto.toLowerCase() !== s.proto.toLowerCase() || String(e.dport) !== String(s.dport)) return false
  if (e.zone.toLowerCase() !== dstZone.toLowerCase()) return false
  return s.src_zone_id ? e.src_zone.toLowerCase() === srcZone.toLowerCase() : !e.src_zone && e.src_ip === s.src_ip
}
