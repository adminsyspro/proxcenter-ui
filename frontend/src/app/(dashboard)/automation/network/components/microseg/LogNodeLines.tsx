import { Box, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegLogNode } from '@/lib/microseg/types'

/** The lag unit and how many of it: seconds up to 120 s, minutes up to 120 min, then hours. */
export function lagParts(seconds: number): { unit: 'second' | 'minute' | 'hour'; count: number } {
  const s = Math.max(0, Math.round(seconds))
  if (s <= 120) return { unit: 'second', count: s }
  const m = Math.round(s / 60)
  return m <= 120 ? { unit: 'minute', count: m } : { unit: 'hour', count: Math.round(m / 60) }
}

/** What is wrong with the forwarder of a node, null when it delivers (or the node is read through the API). */
export function forwarderIssue(n: MicrosegLogNode): 'notInstalled' | 'silent' | 'changed' | null {
  if (n.source !== 'forwarder') return null
  if (n.state !== 'installed') return 'notInstalled'
  if (n.silent) return 'silent'

  return n.drift ? 'changed' : null
}

/** How many nodes of a cluster in forwarder mode have a forwarder that needs a look. */
export function forwarderTrouble(nodes: readonly MicrosegLogNode[]): number {
  return nodes.filter(n => forwarderIssue(n) !== null).length
}

/**
 * The log reader of each node on one line each: its source (the Proxmox API, or the forwarder of the node), its rate
 * over 15 minutes and how far behind the log it reads; for a forwarder that does not deliver, what is wrong with it.
 */
export default function LogNodeLines({ nodes }: { nodes: readonly MicrosegLogNode[] }) {
  const t = useTranslations('microsegPilot.banner')
  const format = useFormatter()
  const lagOf = (seconds: number) => {
    const { unit, count } = lagParts(seconds)

    return format.number(count, { style: 'unit', unit, unitDisplay: 'short' })
  }
  const line = (n: MicrosegLogNode): string => {
    const rate = format.number(Math.round(n.lines_per_min_15m))
    const lag = lagOf(n.lag_seconds)

    if (n.source !== 'forwarder') return t('logNode', { node: n.node, rate, lag })
    switch (forwarderIssue(n)) {
      case 'notInstalled':
        return t('logNodeNotInstalled', { node: n.node })
      case 'silent':
        return n.last_line_at ? t('logNodeSilent', { node: n.node, lag }) : t('logNodeSilentNever', { node: n.node })
      case 'changed':
        return t('logNodeChanged', { node: n.node })
      default:
        return n.last_line_at ? t('logNodeForwarder', { node: n.node, rate, lag }) : t('logNodeIdle', { node: n.node })
    }
  }

  return (
    <Box>
      {nodes.map(n => (
        <Typography key={n.node} variant='caption' sx={{ display: 'block', whiteSpace: 'nowrap' }}>{line(n)}</Typography>
      ))}
    </Box>
  )
}
