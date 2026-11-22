'use client'

import { useMemo } from 'react'
import { Box, Skeleton, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import PagedRows from '@/components/ui/PagedRows'
import { GuestGlyph, NodeGlyph } from '@/components/ui/glyphs'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import { formatBytes } from '@/utils/format'

import PostureCard from './PostureCard'
import type { PostureGuest } from './dashboardPosture'

/** A guest of /sflow/top-talkers: what it sent and received over the collector's window. */
export type TopTalker = { vmid: number; vm_name?: string; node?: string; bytes_in: number; bytes_out: number; packets: number; connection_id?: string }

/** The talkers read, the orchestrator's maximum: the table pages them. */
const TALKERS_LIMIT = 100
/** The collector keeps a sliding window in memory: read again every minute while the Dashboard shows. */
export const TALKERS_REFRESH_MS = 60_000

/** One cluster: filtered by the orchestrator. Several (a shared policy): the fleet's busiest, kept here per cluster. */
export function talkersUrl(connIds: readonly string[]): string {
  const base = `/api/v1/orchestrator/sflow?endpoint=top-talkers&n=${TALKERS_LIMIT}`
  return connIds.length === 1 ? `${base}&connection_id=${encodeURIComponent(connIds[0])}` : base
}

/** Guest, node, in, out: one line per guest. */
const GRID = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 22%) 110px 110px' } as const

const OPTIONS = { refreshInterval: TALKERS_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false }

/** The type of a guest ("qemu", "lxc") from the guest list of the connection, by VMID; qemu when unknown. */
function typeOf(guests: readonly PostureGuest[], vmid: number): string {
  const key = guests.find(g => g.key.endsWith(`/${vmid}`))?.key ?? ''
  const slash = key.lastIndexOf('/')
  const type = slash > 0 ? key.slice(key.lastIndexOf('|') + 1, slash) : ''
  return type || 'qemu'
}

/**
 * "Top talkers": the guests of the connection that sent and received the most over the sFlow collector's sliding
 * window (its memory, no Proxmox call), on the clusters read, those shown kept. Read only while sFlow measures the connection (`enabled`); a refusal (a user
 * outside the provider tenant, whose route it is not) shows nothing. A guest that talks is running: its dot says so.
 */
export default function TopTalkers({ readIds, shown, enabled, guests }: { readIds: readonly string[]; shown: readonly string[]; enabled: boolean; guests: readonly PostureGuest[] }) {
  const t = useTranslations('networkPage.dashboard')
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const { data, error, isLoading } = useSWRFetch<TopTalker[]>(enabled && readIds.length ? talkersUrl(readIds) : null, OPTIONS)
  // The shown clusters (the Dashboard's filter) are kept out of what was read, without another read.
  const idsKey = shown.join('|')
  const rows = useMemo(() => {
    const ids = new Set(idsKey.split('|'))
    return Array.isArray(data) ? data.filter(r => r.bytes_in + r.bytes_out > 0 && (!r.connection_id || ids.has(r.connection_id))) : []
  }, [data, idsKey])
  if (!enabled || !readIds.length || error) return null

  let body: React.ReactNode
  if (isLoading && !data) {
    body = (
      <Box data-testid='talkers-loading' sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {[0, 1, 2].map(i => <Skeleton key={i} variant='rounded' height={28} />)}
      </Box>
    )
  } else if (rows.length === 0) {
    body = <Typography variant='body2' color='text.secondary' data-testid='talkers-empty'>{t('postureTalkersEmpty')}</Typography>
  } else {
    const cell = { px: 1, py: 0.75, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 } as const
    const right = { ...cell, justifyContent: 'flex-end', whiteSpace: 'nowrap' } as const
    body = (
      <Box data-testid='talkers-table' sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 520 }}>
          <Box sx={{ ...GRID, borderBottom: 1, borderColor: 'divider' }}>
            {[t('postureColGuest'), t('postureColNode'), t('postureColIn'), t('postureColOut')].map((label, i) => (
              <Typography key={label} variant='body2' sx={{ ...(i < 2 ? cell : right), fontWeight: 600 }}>{label}</Typography>
            ))}
          </Box>
          <PagedRows items={rows} testId='talkers-pager'>
            {r => (
              <Box key={`${r.connection_id ?? ''}/${r.vmid}`} data-testid='talker-row' sx={{ ...GRID, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={cell}>
                  <GuestGlyph type={typeOf(guests, r.vmid)} status='running' dotBorder={dotBorder} />
                  <Typography variant='body2' noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{r.vm_name || String(r.vmid)}</Typography>
                  <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{r.vmid}</Typography>
                </Box>
                <Box sx={cell}>
                  {r.node ? (
                    <>
                      <NodeGlyph status='online' dark={dark} dotBorder={dotBorder} />
                      <Typography variant='body2' noWrap sx={{ minWidth: 0 }}>{r.node}</Typography>
                    </>
                  ) : <Typography variant='body2' color='text.secondary'>-</Typography>}
                </Box>
                <Typography variant='body2' sx={right}>{formatBytes(r.bytes_in, 1)}</Typography>
                <Typography variant='body2' sx={right}>{formatBytes(r.bytes_out, 1)}</Typography>
              </Box>
            )}
          </PagedRows>
        </Box>
      </Box>
    )
  }

  return <PostureCard testId='talkers-card' title={t('postureTalkersTitle')}>{body}</PostureCard>
}
