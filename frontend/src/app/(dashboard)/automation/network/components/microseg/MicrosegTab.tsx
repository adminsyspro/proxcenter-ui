'use client'

import { useState } from 'react'
import { Alert, Box, CircularProgress, Tab, Tabs, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'

import FirstRunGuide from './FirstRunGuide'
import MicrosegBanner from './MicrosegBanner'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { MICROSEG_SUBTABS, isMicrosegSubTab, type MicrosegSubTab, type MicrosegSubTabProps } from './microsegTabTypes'

const STORAGE_KEY = 'microseg.subTab'

function readStoredSubTab(): MicrosegSubTab | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isMicrosegSubTab(stored) ? stored : null
  } catch {
    return null
  }
}

function storeSubTab(tab: MicrosegSubTab) {
  try {
    window.localStorage.setItem(STORAGE_KEY, tab)
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

/**
 * Content of one sub-tab. The later tasks replace the placeholder of their
 * own sub-tab here: overview (preflight, T9), policy (zones and flows, T4),
 * observation (suggestions, T7), drifts (T9), history (T8).
 */
function SubTabContent({ tab }: { tab: MicrosegSubTab } & MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.subTabs')
  return (
    <Typography role='tabpanel' id={`microseg-panel-${tab}`} aria-labelledby={`microseg-tab-${tab}`} color='text.secondary' sx={{ p: 3 }}>
      {t('placeholder')}
    </Typography>
  )
}

type Props = {
  connectionId: string
  /** Opens the plan view (wired by the plan task); the banner and the first run guide call it. */
  onOpenPlan?: () => void
}

/** The Micro-segmentation tab of /automation/network: banner, first run guide and the five sub-tabs. */
export default function MicrosegTab({ connectionId, onOpenPlan }: Props) {
  const t = useTranslations('microsegPilot')
  const { data: policy, loading, error, reload } = useMicrosegPolicy(connectionId || null)
  // Read once: nothing of the sub-tab shows before the policy has loaded, so this never differs from a server render.
  const [subTab, setSubTab] = useState<MicrosegSubTab>(() => readStoredSubTab() ?? 'overview')

  const goToSubTab = (tab: MicrosegSubTab) => {
    setSubTab(tab)
    storeSubTab(tab)
  }

  if (!connectionId) return <Alert severity='info' sx={{ m: 3 }}>{t('noConnection')}</Alert>

  if (!policy) {
    return (
      <Box sx={{ p: 3 }}>
        {error ? (
          <MicrosegErrorAlert error={error} onRetry={reload} />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CircularProgress size={20} />
            <Typography color='text.secondary'>{loading ? t('loading') : ''}</Typography>
          </Box>
        )}
      </Box>
    )
  }

  const firstRun = !policy.last_revision && policy.zones.length === 0
  const contentProps: MicrosegSubTabProps = { connectionId, policy, reloadPolicy: reload, goToSubTab, onOpenPlan }

  return (
    <Box sx={{ p: 3 }}>
      <MicrosegBanner connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} />
      {firstRun && <FirstRunGuide goToSubTab={goToSubTab} onOpenPlan={onOpenPlan} />}
      <Tabs value={subTab} onChange={(_, v: MicrosegSubTab) => goToSubTab(v)} variant='scrollable' scrollButtons='auto' aria-label={t('subTabs.label')}>
        {MICROSEG_SUBTABS.map(tab => (
          <Tab
            key={tab}
            value={tab}
            id={`microseg-tab-${tab}`}
            aria-controls={`microseg-panel-${tab}`}
            label={t(`subTabs.${tab}`)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          />
        ))}
      </Tabs>
      <SubTabContent tab={subTab} {...contentProps} />
    </Box>
  )
}
