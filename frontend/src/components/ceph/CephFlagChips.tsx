'use client'

import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import { Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material'

import { byFlagOrder, flagsOnOsd, scopedFlagEntries, scopedFlagKey, type ScopedFlagMap } from '@/lib/ceph/osdFlagsView'

/*
   The flags `ceph osd set-group` sets on one CRUSH host or one OSD (ui#1164),
   shared by every Ceph view so a per-host noout is never invisible: the flag
   list of the cluster contexts, and the Status cell of the OSD tables. Plain
   text grouped by scope rather than one rounded chip per flag:
   "pve3  noout · noin (x) | osd.4  nodown".
*/

type ScopedChipsProps = Readonly<{
  hostFlags: ScopedFlagMap
  osdFlags: ScopedFlagMap
  /** The cluster-wide flags, shown first when given. */
  globalFlags?: string[]
  /** The key being written: `host:flag` for a host, the flag name for the cluster. */
  toggling?: string | null
  /** Given, a host group can be removed (all its flags); OSD-level flags stay read-only. */
  onRemoveHost?: (host: string, flag: string) => unknown
  /** Given, the cluster-wide group can be removed. */
  onRemoveGlobal?: (flag: string) => unknown
  /** One group per line, for a narrow card; side by side with separators otherwise. */
  stacked?: boolean
}>

interface FlagGroup {
  key: string
  label: string
  flags: string[]
  tooltip: string
  busy: boolean
  onRemove?: () => Promise<void>
}

/** One "scope  flag · flag (x)" group, flowing like text so a long one wraps with its button. */
function Group({ group, removeLabel }: Readonly<{ group: FlagGroup; removeLabel: string }>) {
  return (
    <Typography component='span' variant='subtitle2' data-testid={`ceph-flag-group-${group.key}`} sx={{ display: 'inline' }}>
      <Tooltip title={group.tooltip}>
        <span>
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap', mr: 1.5 }}>{group.label}</Box>
          <Box component='span' sx={{ fontWeight: 600, color: 'warning.main' }}>{group.flags.join(' · ')}</Box>
        </span>
      </Tooltip>
      {group.onRemove && (
        <Tooltip title={removeLabel}>
          <span>
            <IconButton
              size='small'
              aria-label={removeLabel}
              disabled={group.busy}
              onClick={() => void group.onRemove?.()}
              sx={{ p: 0.25, ml: 0.5, verticalAlign: 'middle', color: 'text.disabled', '&:hover': { color: 'warning.main' } }}
            >
              {group.busy ? <CircularProgress size={12} /> : <i className='ri-close-circle-line' style={{ fontSize: 14 }} />}
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Typography>
  )
}

/** Removes the flags one after the other, so each write sees the previous one. */
async function removeAll(flags: string[], remove: (flag: string) => unknown) {
  for (const flag of flags) await remove(flag)
}

/** The flag groups of a cluster: cluster-wide, then per host, then per OSD; nothing when there is none. */
export function CephScopedFlagChips({ hostFlags, osdFlags, globalFlags = [], toggling = null, onRemoveHost, onRemoveGlobal, stacked = false }: ScopedChipsProps) {
  const t = useTranslations()
  const groups: FlagGroup[] = []

  if (globalFlags.length > 0) {
    const label = t('ceph.flagsClusterWide')
    groups.push({
      key: 'cluster', label, flags: [...globalFlags].sort(byFlagOrder),
      tooltip: t('ceph.osdFlagsDescription'),
      busy: globalFlags.some(f => toggling === f),
      onRemove: onRemoveGlobal ? () => removeAll(globalFlags, onRemoveGlobal) : undefined,
    })
  }

  const byTarget = new Map<string, { scope: 'host' | 'osd'; flags: string[] }>()
  for (const { target, flag, scope } of scopedFlagEntries(hostFlags, osdFlags)) {
    const entry = byTarget.get(target) ?? { scope, flags: [] }
    entry.flags.push(flag)
    byTarget.set(target, entry)
  }
  for (const [target, { scope, flags }] of byTarget) {
    groups.push({
      key: target, label: target, flags,
      tooltip: scope === 'host'
        ? t('cephNoout.hostFlagTooltip', { flag: flags.join(', '), host: target, count: flags.length })
        : t('ceph.osdFlagOnOsd', { flag: flags.join(', '), osd: target, count: flags.length }),
      busy: flags.some(f => toggling === scopedFlagKey(target, f)),
      onRemove: scope === 'host' && onRemoveHost ? () => removeAll(flags, f => onRemoveHost(target, f)) : undefined,
    })
  }

  if (groups.length === 0) return null

  return (
    <Box
      sx={stacked
        ? { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', rowGap: 0.5 }
        : { display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 0.5, flexWrap: 'wrap' }}
      data-testid='ceph-scoped-flags'
    >
      {groups.map((group, i) => (
        <Fragment key={group.key}>
          {i > 0 && !stacked && <Box component='span' aria-hidden sx={{ alignSelf: 'stretch', borderLeft: '1px solid', borderColor: 'divider' }} />}
          <Group group={group} removeLabel={t('cephNoout.removeFlag', { flag: group.flags.join(', '), host: group.label })} />
        </Fragment>
      ))}
    </Box>
  )
}

type OsdChipsProps = Readonly<{
  osdId: number | string
  /** The CRUSH host of the OSD, matched against the host flag map like a node name. */
  host?: string | null
  osdFlags: ScopedFlagMap
  hostFlags: ScopedFlagMap
  /** The height of the up/in chips of the same cell, so the row stays one line. */
  height?: number
}>

/**
 * The flags that apply to one OSD, after its up/in chips, as plain text: its
 * own and its host's ("noout · noin"). The cluster-wide ones, the same for
 * every OSD, are shown once by the table rather than on each row.
 */
export function OsdFlagChips({ osdId, host, osdFlags, hostFlags, height = 24 }: OsdChipsProps) {
  const t = useTranslations()
  const applied = [...flagsOnOsd(osdId, host, osdFlags, hostFlags)].sort((a, b) => byFlagOrder(a.flag, b.flag))

  if (applied.length === 0) return null

  const tooltip = applied
    .map(({ target, flag, scope }) => (scope === 'host' ? t('ceph.osdFlagOnHost', { flag, host: target, count: 1 }) : t('ceph.osdFlagOnOsd', { flag, osd: target, count: 1 })))
    .join(' · ')

  return (
    <Tooltip title={tooltip}>
      <Typography
        component='span'
        variant='caption'
        noWrap
        data-testid='osd-flags'
        sx={{ color: 'warning.main', fontWeight: 700, lineHeight: `${height}px`, ml: 0.5 }}
      >
        {applied.map(a => a.flag).join(' · ')}
      </Typography>
    </Tooltip>
  )
}
