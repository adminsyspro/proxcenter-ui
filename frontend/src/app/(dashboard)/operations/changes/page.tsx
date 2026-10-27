'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Tooltip,
  Typography
} from '@mui/material'

import { buildChangesCsv } from '@/lib/changes/csv'
import { actionMeta } from '@/lib/changes/journal'
import type { JournalChange } from '@/lib/changes/journal'
import { dateStamp, downloadCsv } from '@/lib/export/download'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useChanges } from '@/hooks/useChanges'
import { useGuestStatus } from '@/hooks/useGuestStatus'
import { useSWRFetch } from '@/hooks/useSWRFetch'

import ChangeJournal from '@/components/changes/ChangeJournal'
import EmptyState from '@/components/EmptyState'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { CardsSkeleton } from '@/components/skeletons'

const RESOURCE_LABELS: Record<string, string> = { vm: 'VM', ct: 'Container', node: 'Node', storage: 'Storage', pool: 'Pool' }

export default function ChangesPage() {
  const t = useTranslations()
  const { hasFeature, loading: licenseLoading } = useLicense()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('changes.title'), '', 'ri-git-commit-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const [purgeOpen, setPurgeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [purging, setPurging] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [retentionDays, setRetentionDays] = useState(30)

  const { data: response, isLoading, error, mutate } = useChanges({ limit: 5000 })
  const { data: settingsData, mutate: mutateSettings } = useSWRFetch('/api/v1/changes/settings')
  const guestStatus = useGuestStatus()

  const changes: JournalChange[] = useMemo(() => response?.data || [], [response])
  const currentRetention = settingsData?.retentionDays || 30

  const handlePurge = useCallback(async () => {
    setPurging(true)

    try {
      await fetch('/api/v1/changes', { method: 'DELETE' })
      mutate()
      setPurgeOpen(false)
    } catch (e) {
      console.error('Purge failed:', e)
    } finally {
      setPurging(false)
    }
  }, [mutate])

  // The CSV carries what the filters select, every page of it, not just the
  // rows currently on screen.
  const exportCsv = useCallback((rows: JournalChange[]) => {
    const csv = buildChangesCsv(rows, {
      headers: [
        t('changes.csvDate'),
        t('changes.csvResourceType'),
        t('changes.csvResourceId'),
        t('changes.csvResourceName'),
        t('changes.csvAction'),
        t('changes.csvUser'),
        t('changes.csvNode'),
        t('changes.csvConnection'),
        t('changes.csvFieldCount'),
        t('changes.csvDetails')
      ],
      resourceType: type => RESOURCE_LABELS[type || ''] || type || '',
      action: action => (action ? t(actionMeta(action).label) : '')
    })

    downloadCsv(csv, `changes-${dateStamp()}.csv`)
  }, [t])

  const handleOpenSettings = useCallback(() => {
    setRetentionDays(currentRetention)
    setSettingsOpen(true)
  }, [currentRetention])

  const handleSaveSettings = useCallback(async () => {
    setSavingSettings(true)

    try {
      await fetch('/api/v1/changes/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays })
      })
      mutateSettings()
      setSettingsOpen(false)
    } catch (e) {
      console.error('Settings save failed:', e)
    } finally {
      setSavingSettings(false)
    }
  }, [retentionDays, mutateSettings])

  if (!licenseLoading && !hasFeature(Features.CHANGE_TRACKING)) {
    return <EnterpriseGuard requiredFeature={Features.CHANGE_TRACKING} featureName={t('changes.title')}><span /></EnterpriseGuard>
  }

  if (isLoading) return <CardsSkeleton count={3} />

  // Icon-only actions, pinned right. Each carries its own aria-label: with no
  // visible text, a disabled button wrapped in the tooltip's <span> would
  // otherwise have no accessible name.
  const toolbar = (filtered: JournalChange[]) => (
    <>
      <Tooltip title={`${t('changes.settings')} · ${t('changes.retentionInfo', { days: currentRetention })}`}>
        <IconButton size='small' aria-label={t('changes.settings')} onClick={handleOpenSettings}>
          <i className='ri-settings-3-line' style={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={`${t('common.export')} CSV`}>
        <span>
          <IconButton
            size='small'
            aria-label={`${t('common.export')} CSV`}
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
          >
            <i className='ri-download-line' style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('common.refresh')}>
        <span>
          <IconButton size='small' aria-label={t('common.refresh')} onClick={() => mutate()} disabled={isLoading}>
            <i className='ri-refresh-line' style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('changes.purge')}>
        <span>
          <IconButton
            size='small'
            color='error'
            aria-label={t('changes.purge')}
            onClick={() => setPurgeOpen(true)}
            disabled={changes.length === 0}
          >
            <i className='ri-delete-bin-line' style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
    </>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      {error && <Alert severity='error'>{t('common.error')}</Alert>}

      {changes.length === 0 ? (
        <EmptyState
          icon='ri-git-commit-line'
          title={t('changes.emptyTitle')}
          description={t('changes.emptyDescription')}
        />
      ) : (
        <ChangeJournal changes={changes} guestStatus={guestStatus} toolbar={toolbar} fill timeline />
      )}

      <Dialog open={purgeOpen} onClose={() => setPurgeOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-delete-bin-line' style={{ color: 'var(--mui-palette-error-main)' }} />
          {t('changes.purgeTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='body2'>
            {t('changes.purgeDescription', { count: changes.length })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPurgeOpen(false)}>{t('common.cancel')}</Button>
          <Button color='error' variant='contained' onClick={handlePurge} disabled={purging}>
            {purging ? t('common.loading') : t('changes.purgeConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-settings-3-line' />
          {t('changes.settingsTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant='body2' sx={{ mb: 3 }}>
            {t('changes.retentionDescription')}
          </Typography>
          <Typography variant='subtitle2' sx={{ mb: 1 }}>
            {t('changes.retentionDays')}: <strong>{retentionDays}</strong> {t('changes.days')}
          </Typography>
          <Slider
            value={retentionDays}
            onChange={(_, v) => setRetentionDays(v as number)}
            min={1}
            max={365}
            step={1}
            marks={[
              { value: 7, label: '7d' },
              { value: 30, label: '30d' },
              { value: 90, label: '90d' },
              { value: 180, label: '180d' },
              { value: 365, label: '365d' }
            ]}
            valueLabelDisplay='auto'
            valueLabelFormat={v => `${v}d`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' onClick={handleSaveSettings} disabled={savingSettings}>
            {savingSettings ? t('common.loading') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
