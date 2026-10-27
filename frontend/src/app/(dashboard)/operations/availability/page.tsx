'use client'

import { useEffect } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { useTranslations } from 'next-intl'
import { Box, Tab, Tabs, Typography } from '@mui/material'

import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import { usePageTitle } from '@/contexts/PageTitleContext'

import MaintenanceTab from './components/MaintenanceTab'
import OverviewTab from './components/OverviewTab'
import PoliciesTab from './components/PoliciesTab'

type TabId = 'overview' | 'policies' | 'maintenance'

const TABS: TabId[] = ['overview', 'policies', 'maintenance']

export default function AvailabilityPage() {
  const t = useTranslations('availability')
  const router = useRouter()
  const searchParams = useSearchParams()

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('title'), t('subtitle'), 'ri-heart-pulse-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const requested = searchParams.get('tab') as TabId | null
  const tab: TabId = requested && TABS.includes(requested) ? requested : 'overview'

  return (
    <EnterpriseGuard requiredFeature={Features.SLA_MONITORING} featureName={t('title')}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Typography variant='h5'>{t('title')}</Typography>
          <Typography variant='body2' color='text.secondary'>{t('subtitle')}</Typography>
        </Box>
        <Tabs
          value={tab}
          onChange={(_, next: TabId) => router.replace(`?tab=${next}`)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {TABS.map(id => <Tab key={id} value={id} label={t(`tabs.${id}`)} />)}
        </Tabs>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'policies' && <PoliciesTab />}
        {tab === 'maintenance' && <MaintenanceTab />}
      </Box>
    </EnterpriseGuard>
  )
}
