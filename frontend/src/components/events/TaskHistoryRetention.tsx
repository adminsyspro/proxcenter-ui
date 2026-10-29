'use client'

import { useState } from 'react'

import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Slider from '@mui/material/Slider'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslations } from 'next-intl'

import { useRBAC } from '@/contexts/RBACContext'
import { useSWRFetch } from '@/hooks/useSWRFetch'

const DEFAULT_DAYS = 90
const MAX_DAYS = 730
const MARKS = [30, 90, 180, 365, 730].map(value => ({ value, label: `${value}d` }))

interface RetentionSettings {
  retentionDays?: number
  maxRetentionDays?: number
}

/**
 * How long ProxCenter keeps its copy of the Proxmox tasks (#1225): one value
 * for the whole fleet, so only an administrator who may change settings sees
 * the button.
 */
export default function TaskHistoryRetention() {
  const t = useTranslations()
  const rbac = useRBAC()
  const canEdit = rbac?.hasPermission?.('admin.settings') ?? false
  const { data, mutate } = useSWRFetch<RetentionSettings>(canEdit ? '/api/v1/events/archive/settings' : null)
  const current = data?.retentionDays ?? DEFAULT_DAYS
  const max = data?.maxRetentionDays ?? MAX_DAYS

  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) return null

  const save = async () => {
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/events/archive/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: days })
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))

        setError(body?.error || res.statusText)

        return
      }

      await mutate()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Tooltip title={t('eventsPage.archive.retentionInfo', { days: current })}>
        <IconButton
          size='small'
          aria-label={t('eventsPage.archive.retentionTitle')}
          onClick={() => {
            setDays(current)
            setError(null)
            setOpen(true)
          }}
        >
          <i className='ri-settings-3-line' style={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-history-line' />
          {t('eventsPage.archive.retentionTitle')}
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Typography variant='body2' sx={{ mb: 3 }}>
            {t('eventsPage.archive.retentionDescription')}
          </Typography>
          <Typography variant='subtitle2' sx={{ mb: 1 }}>
            {t('eventsPage.archive.retentionDays', { days })}
          </Typography>
          <Slider
            aria-label={t('eventsPage.archive.retentionTitle')}
            value={days}
            onChange={(_, v) => setDays(v as number)}
            min={1}
            max={max}
            step={1}
            marks={MARKS.filter(m => m.value <= max)}
            valueLabelDisplay='auto'
            valueLabelFormat={v => `${v}d`}
          />
          {error && (
            <Alert severity='error' sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' onClick={() => void save()} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
