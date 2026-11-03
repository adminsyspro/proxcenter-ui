'use client'

import { useState } from 'react'
import { Alert, Box, Button, Collapse, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

type Props = {
  /** What failed on the last load of the firewall data (causes joined by " · "); nothing is shown without it. */
  error: string | null | undefined
  onRetry?: () => void
}

/** The page joins the distinct causes of a failed load with this separator. */
const SEPARATOR = ' · '

/** The distinct causes of a failed load, in order. */
export function loadErrorCauses(error: string | null | undefined): string[] {
  return [...new Set((error ?? '').split(SEPARATOR).map(e => e.trim()).filter(Boolean))]
}

/**
 * Shown at the top of the tabs that list firewall data when a load failed (#1022): an empty list or a cluster
 * without options would otherwise read as "nothing configured". Compact: the first cause on one line, "and N more"
 * with every cause in the tooltip and under Details.
 */
export default function FirewallLoadAlert({ error, onRetry }: Props) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const causes = loadErrorCauses(error)
  if (causes.length === 0) return null

  const more = causes.length - 1
  const summary = t('networkPage.loadError', { error: causes[0] }) + (more > 0 ? ` ${t('networkPage.loadErrorMore', { count: more })}` : '')

  return (
    <Alert
      severity='warning'
      sx={{ mb: 2, py: 0.25, '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden', flex: '1 1 0' } }}
      action={(
        <Box sx={{ display: 'flex', gap: 0.5, whiteSpace: 'nowrap' }}>
          {more > 0 && (
            <Button color='inherit' size='small' aria-expanded={open} onClick={() => setOpen(v => !v)}>
              {t(open ? 'networkPage.loadErrorHideDetails' : 'networkPage.loadErrorDetails')}
            </Button>
          )}
          {onRetry && <Button color='inherit' size='small' onClick={onRetry}>{t('common.retry')}</Button>}
        </Box>
      )}
    >
      <Tooltip title={<Box component='span' sx={{ whiteSpace: 'pre-line' }}>{causes.join('\n')}</Box>}>
        <Typography variant='body2' noWrap>{summary}</Typography>
      </Tooltip>
      <Collapse in={open} unmountOnExit>
        <Box component='ul' sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {causes.map(cause => (
            <Box component='li' key={cause} sx={{ minWidth: 0 }}>
              <Tooltip title={cause}>
                <Typography variant='caption' noWrap sx={{ display: 'block' }}>{cause}</Typography>
              </Tooltip>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Alert>
  )
}
