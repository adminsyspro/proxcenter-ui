import { byteRateUnit } from '@/lib/ceph/overview'

/** What the formatters need from next-intl's `useFormatter()`. */
export interface NumberFormatter {
  number: (value: number, options?: { maximumFractionDigits?: number }) => string
}

/** One decimal under 10, none above: operations per second. */
export function formatOps(format: NumberFormatter, v: number): string {
  return format.number(v, { maximumFractionDigits: v > 0 && v < 10 ? 1 : 0 })
}

/** Bytes per second in binary units (B/s, KiB/s, MiB/s...), one decimal under 10. */
export function formatByteRate(format: NumberFormatter, v: number): string {
  const unit = byteRateUnit(v)
  const scaled = v / unit.divisor

  return `${format.number(scaled, { maximumFractionDigits: scaled > 0 && scaled < 10 ? 1 : 0 })} ${unit.unit}`
}
