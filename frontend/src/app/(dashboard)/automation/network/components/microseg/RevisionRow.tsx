'use client'

import { useState } from 'react'
import { Box, Button, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegRevision } from '@/lib/microseg/types'

import { OneLine } from './dialogParts'
import { formatWhen } from './summaryModel'

type Props = {
  revision: MicrosegRevision
  /** The newest revision, the one the draft was last compared with. */
  latest: boolean
  onRestore: () => void
}

/** One revision on one line: version, author, date, what it froze, Restore; the zone names sit under the chevron. */
export default function RevisionRow({ revision, latest, onRestore }: Props) {
  const t = useTranslations('microsegPilot.history.revisions')
  const tp = useTranslations('microsegPilot.policy')
  const format = useFormatter()
  const [open, setOpen] = useState(false)

  const when = formatWhen(format, revision.created_at)
  const zones = revision.snapshot?.zones ?? []
  const flows = revision.snapshot?.flows ?? []
  const counts = revision.snapshot ? t('counts', { zones: zones.length, flows: flows.length }) : ''
  const version = t('version', { version: revision.version })
  // Old revisions may carry no author: no "by" left hanging then.
  const author = revision.author?.trim()
  const by = author ? t('by', { author }) : ''

  return (
    <Box role='listitem' aria-label={version} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, pr: 1, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <i className='ri-history-line' style={{ fontSize: 16, flexShrink: 0 }} />
        <Typography noWrap fontWeight={600} sx={{ flexShrink: 0 }}>{version}</Typography>
        {latest && <Chip size='small' color='primary' variant='outlined' label={t('latest')} sx={{ flexShrink: 0 }} />}
        {by && (
          <Tooltip title={by}>
            <Typography noWrap color='text.secondary' sx={{ flex: '0 1 auto', maxWidth: 180 }}>{by}</Typography>
          </Tooltip>
        )}
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{when}</Typography>
        <Tooltip title={counts}>
          <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{counts}</Typography>
        </Tooltip>
        <Button size='small' variant='outlined' onClick={onRestore} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('restore')}</Button>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 7, pr: 2, pb: 1.5, minWidth: 0 }}>
          <OneLine text={t('detail.tagPrefix', { prefix: revision.snapshot?.tag_prefix ?? '' })} />
          <OneLine text={t('detail.zones', { names: zones.map(z => z.name).join(', ') || t('detail.none') })} />
        </Box>
      </Collapse>
    </Box>
  )
}
