'use client'

import { Box, Tooltip, Typography } from '@mui/material'

import type { GuestLatency } from '@/hooks/useDiskLatency'
import { formatLatency } from '@/lib/metrics/latency'
import type { DiskLatency, StorageLatency } from '@/lib/orchestrator/client'

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
