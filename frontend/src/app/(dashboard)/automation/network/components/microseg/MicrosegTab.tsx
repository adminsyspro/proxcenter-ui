'use client'

import { useCallback, useState } from 'react'
import { Alert, Box, CircularProgress, Tab, Tabs, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'

import { microsegBaseUrl } from '@/lib/microseg/api'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'

import DriftsPanel from './DriftsPanel'
import FirstRunGuide from './FirstRunGuide'
import MicrosegBanner from './MicrosegBanner'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import ObservationPanel from './ObservationPanel'
import PlanDialog from './PlanDialog'
import PolicyPanel from './PolicyPanel'
import RunStrip from './RunStrip'
import ZoneMap from './ZoneMap'
import { MICROSEG_SUBTABS, isMicrosegSubTab, type MicrosegSubTab, type MicrosegSubTabProps, type TrackedRun } from './microsegTabTypes'

const STORAGE_KEY = 'microseg.subTab'

/** The sub-tabs that have their content; the others still show the placeholder. */
const PANELS = new Set<MicrosegSubTab>(['overview', 'policy', 'observation', 'drifts'])

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
function SubTabContent({ tab, ...props }: { tab: MicrosegSubTab } & MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.subTabs')
  return (
    <Box role='tabpanel' id={`microseg-panel-${tab}`} aria-labelledby={`microseg-tab-${tab}`} sx={{ pt: 3 }}>
      {tab === 'overview' && <ZoneMap {...props} />}
      {tab === 'policy' && <PolicyPanel {...props} />}
      {tab === 'observation' && <ObservationPanel {...props} />}
      {tab === 'drifts' && <DriftsPanel {...props} />}
      {!PANELS.has(tab) && <Typography color='text.secondary' sx={{ px: 3, pb: 3 }}>{t('placeholder')}</Typography>}
    </Box>
  )
}

type Props = {
  connectionId: string
}

/** The Micro-segmentation tab of /automation/network: banner, first run guide and the five sub-tabs. */
export default function MicrosegTab({ connectionId }: Props) {
  const t = useTranslations('microsegPilot')
  const { data: policy, loading, error, reload } = useMicrosegPolicy(connectionId || null)
  // Read once: nothing of the sub-tab shows before the policy has loaded, so this never differs from a server render.
  const [subTab, setSubTab] = useState<MicrosegSubTab>(() => readStoredSubTab() ?? 'overview')

  // The runs live here, not in a sub-tab: switching sub-tab must not lose them.
  const [runs, setRuns] = useState<TrackedRun[]>([])
  // The plan window is opened by the banner, the pending changes bar and the first run guide.
  const [planOpen, setPlanOpen] = useState(false)
  const onOpenPlan = useCallback(() => setPlanOpen(true), [])
  const { mutate } = useSWRConfig()

  const startRun = useCallback((run: TrackedRun) => {
    setRuns(prev => (prev.some(r => r.runId === run.runId) ? prev : [...prev, run]))
  }, [])
  const removeRun = useCallback((runId: string) => setRuns(prev => prev.filter(r => r.runId !== runId)), [])
  const refreshAfterRun = useCallback(() => {
    void reload()
    void mutate(`${microsegBaseUrl(connectionId)}/status`)
  }, [reload, mutate, connectionId])

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
  const contentProps: MicrosegSubTabProps = { connectionId, policy, reloadPolicy: reload, goToSubTab, onOpenPlan, startRun }

  return (
    <Box sx={{ p: 3 }}>
      <MicrosegBanner connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} />
      <RunStrip connectionId={connectionId} runs={runs} onFinished={refreshAfterRun} onRemove={removeRun} />
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
      <PlanDialog
        open={planOpen}
        connectionId={connectionId}
        policy={policy}
        reloadPolicy={reload}
        startRun={startRun}
        onClose={() => setPlanOpen(false)}
      />
    </Box>
  )
}
