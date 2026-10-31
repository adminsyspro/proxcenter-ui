'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { useTranslations } from 'next-intl'
import { mutate } from 'swr'
import { Box, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'

import IncidentDialog from '@/components/incidents/IncidentDialog'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import { usePageTitle } from '@/contexts/PageTitleContext'

import { IncidentDialogContext } from './components/IncidentDialogContext'
import MaintenanceTab from './components/MaintenanceTab'
import OverviewTab from './components/OverviewTab'
import MeasuredConnectionsDialog, { useMeasuredSettings } from './components/MeasuredConnectionsDialog'
import PoliciesTab from './components/PoliciesTab'

type TabId = 'overview' | 'policies' | 'maintenance'

const TABS: TabId[] = ['overview', 'policies', 'maintenance']

const NONE: readonly string[] = []
const NO_POLICIES: Readonly<Record<string, string[]>> = {}

interface DialogTarget {
  incidentId: string | null
  seedAlertId?: string
}

// The tooltip of an outage reads the incident title and comment count: forget what was cached once the panel changed one.
const refreshOutageMatches = () => mutate(key => Array.isArray(key) && key[0] === 'for-outages')

export default function AvailabilityPage() {
  const t = useTranslations('availability')
  const router = useRouter()
  const searchParams = useSearchParams()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('title'), t('subtitle'), 'ri-heart-pulse-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // One panel for the whole page; mounted at the first opening so a page that never opens it pays nothing.
  const [target, setTarget] = useState<DialogTarget | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const openDialog = useCallback((incidentId: string | null, seedAlertId?: string) => {
    setTarget({ incidentId, seedAlertId })
    setDialogOpen(true)
  }, [])

  const dialogApi = useMemo(() => ({ open: openDialog }), [openDialog])

  // The provider administrators read the settings, so they get the button; anyone else a 404 and none.
  const { data: settings } = useMeasuredSettings()
  const [configOpen, setConfigOpen] = useState(false)
  // A new key at each opening: the dialog starts again from what is measured.
  const [configKey, setConfigKey] = useState(0)
  const openConfig = useCallback(() => {
    setConfigKey(k => k + 1)
    setConfigOpen(true)
  }, [])

  const requested = searchParams.get('tab') as TabId | null
  const tab: TabId = requested && TABS.includes(requested) ? requested : 'overview'

  return (
    <EnterpriseGuard requiredFeature={Features.SLA_MONITORING} featureName={t('title')}>
      <IncidentDialogContext.Provider value={dialogApi}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant='h5'>{t('title')}</Typography>
              <Typography variant='body2' color='text.secondary'>{t('subtitle')}</Typography>
            </Box>
            {settings && (
              <Tooltip title={t('measured.open')}>
                <IconButton aria-label={t('measured.open')} onClick={openConfig}>
                  <i className='ri-settings-3-line' aria-hidden='true' />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          <Tabs
            value={tab}
            onChange={(_, next: TabId) => router.replace(`?tab=${next}`)}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            {TABS.map(id => <Tab key={id} value={id} label={t(`tabs.${id}`)} />)}
          </Tabs>
          {tab === 'overview' && <OverviewTab onConfigure={settings ? openConfig : undefined} />}
          {tab === 'policies' && <PoliciesTab onConfigure={settings ? openConfig : undefined} />}
          {tab === 'maintenance' && <MaintenanceTab />}
        </Box>
        {settings && (
          <MeasuredConnectionsDialog
            key={configKey}
            open={configOpen}
            measured={settings.measuredConnections ?? NONE}
            policies={settings.policiesByConnection ?? NO_POLICIES}
            onClose={() => setConfigOpen(false)}
          />
        )}
        {target && (
          <IncidentDialog
            open={dialogOpen}
            incidentId={target.incidentId}
            seedAlertId={target.seedAlertId}
            onClose={() => setDialogOpen(false)}
            onChanged={refreshOutageMatches}
          />
        )}
      </IncidentDialogContext.Provider>
    </EnterpriseGuard>
  )
}
