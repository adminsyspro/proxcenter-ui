import type { ChartSeriesToggle } from '@/app/(dashboard)/infrastructure/inventory/components/ChartSeriesToggles'

import { latencyKey } from './latencySeries'

/** Colours of the two bandwidth areas of the Disk I/O chart, shared with its legend (#1011). */
export const DISK_IO_COLORS = { read: '#ef4444', write: '#fca5a5' } as const

/**
 * The legend of the Disk I/O chart: the two bandwidth areas, then one entry
 * per disk carrying a latency line, in the colour that line is drawn with.
 */
export function diskIoLegendSeries(
  disks: ReadonlyArray<string>,
  labels: { read: string; write: string },
  lineColors: ReadonlyArray<string>,
): ChartSeriesToggle[] {
  return [
    { key: 'diskReadBps', label: labels.read, color: DISK_IO_COLORS.read },
    { key: 'diskWriteBps', label: labels.write, color: DISK_IO_COLORS.write },
    ...disks.map((disk, i) => ({ key: latencyKey(disk), label: disk, color: lineColors[i % lineColors.length] })),
  ]
}

/** True when the RRD series carries the guest's IO pressure (PVE 9); older archives have no such field. */
export function hasIoPressureSeries(series: ReadonlyArray<{ psiIoSome?: number }>): boolean {
  return series.some(p => p.psiIoSome != null)
}
