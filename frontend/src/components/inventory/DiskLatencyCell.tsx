'use client'

import { Box, Tooltip, Typography } from '@mui/material'

import type { GuestLatency } from '@/hooks/useDiskLatency'
import { formatBandwidth, formatPressure } from '@/lib/metrics/diskIo'
import { formatLatency } from '@/lib/metrics/latency'
import type { DiskLatency, IoPressure, StorageLatency } from '@/lib/orchestrator/client'

/**
 * One tooltip line per virtual disk: name, storage when known, read and write
 * latency of the last collection and the worst collection of the window (#881).
 */
export function guestLatencyLines(disks: DiskLatency[]): string[] {
  return disks.map(d =>
    `${d.disk}${d.storage ? ` · ${d.storage}` : ''}: R ${formatLatency(d.read_ms)} / W ${formatLatency(d.write_ms)}, max ${formatLatency(d.window_max_ms)}`,
  )
}

const Dash = ({ caption }: { caption?: boolean }) => (
  <Typography variant={caption ? 'caption' : 'body2'} sx={{ opacity: 0.5 }}>—</Typography>
)

/** VM table cell: the guest's worst disk at the last collection, disks in the tooltip. */
export function GuestLatencyCell({ entry }: { entry?: GuestLatency }) {
  if (!entry) return <Dash caption />

  return (
    <Tooltip
      title={
        <Box>
          {guestLatencyLines(entry.disks).map(line => (
            <Typography key={line} variant='caption' display='block'>{line}</Typography>
          ))}
        </Box>
      }
    >
      <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>{formatLatency(entry.latencyMs)}</Typography>
    </Tooltip>
  )
}

/** Storage overview cell: the storage-wide figure, guests and window maximum in the tooltip. */
export function StorageLatencyCell({ entry, tooltip }: { entry?: StorageLatency; tooltip: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      {entry ? (
        <Tooltip title={tooltip}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{formatLatency(entry.latency_ms)}</Typography>
        </Tooltip>
      ) : (
        <Dash />
      )}
    </Box>
  )
}

type Direction = 'read' | 'write'

/**
 * One tooltip line per virtual disk: name, storage when known, read and write
 * bandwidth of the last collection (#1011). A disk the orchestrator reported
 * without bandwidth (it predates the figure) shows a dash for it.
 */
export function guestBandwidthLines(disks: DiskLatency[]): string[] {
  return disks.map(d =>
    `${d.disk}${d.storage ? ` · ${d.storage}` : ''}: R ${formatBandwidth(d.read_bps ?? Number.NaN)} / W ${formatBandwidth(d.write_bps ?? Number.NaN)}`,
  )
}

/** VM table cell: the guest's bandwidth in one direction, summed over its disks, disks in the tooltip. */
export function GuestBandwidthCell({ entry, direction }: { entry?: GuestLatency; direction: Direction }) {
  const value = direction === 'read' ? entry?.readBps : entry?.writeBps

  if (!entry || typeof value !== 'number') return <Dash caption />

  return (
    <Tooltip
      title={
        <Box>
          {guestBandwidthLines(entry.disks).map(line => (
            <Typography key={line} variant='caption' display='block'>{line}</Typography>
          ))}
        </Box>
      }
    >
      <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>{formatBandwidth(value)}</Typography>
    </Tooltip>
  )
}

/**
 * VM table cell: the guest's IO pressure stall, the "some" share as the
 * figure (the first one to move when the guest waits on its disks), both
 * shares in the supplied tooltip.
 */
export function GuestIoPressureCell({ pressure, tooltip }: { pressure?: IoPressure; tooltip: string }) {
  if (!pressure) return <Dash caption />

  return (
    <Tooltip title={tooltip}>
      <Typography variant='body2' sx={{ fontSize: '0.7rem' }}>{formatPressure(pressure.some)}</Typography>
    </Tooltip>
  )
}

/** Storage overview cell: the storage-wide bandwidth in one direction, guests and disks in the tooltip. */
export function StorageBandwidthCell({ entry, direction, tooltip }: { entry?: StorageLatency; direction: Direction; tooltip: string }) {
  const value = direction === 'read' ? entry?.read_bps : entry?.write_bps

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      {typeof value === 'number' ? (
        <Tooltip title={tooltip}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{formatBandwidth(value)}</Typography>
        </Tooltip>
      ) : (
        <Dash />
      )}
    </Box>
  )
}
