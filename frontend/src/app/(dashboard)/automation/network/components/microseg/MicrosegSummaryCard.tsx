'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, Button, Chip, Skeleton, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegDrifts } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import DashboardStateCard, { STATE_AMBER, STATE_GREEN, STATE_GREY, STATE_RED, StateRow } from '../DashboardStateCard'
import { coverage } from './coverage'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { useDialogAction } from './dialogParts'
import { MicrosegWriteContext, WriteTip, useCanManageMicroseg } from './microsegAccess'
import { adminRunsMark, clusterFirewallOff, deployedCounts, formatWhen, lastCheckAt, policyNotSetUp, stillPaused, unzonedRunning } from './summaryModel'
import { NOW_REFRESH_MS, useNow } from './useNow'

type Props = {
  connectionId: string
  /** Shown next to the title: the card is about this connection only. */
  connectionName?: string
  /** Opens the Micro-segmentation tab. */
  onOpen: () => void
}

/**
 * The Micro-segmentation at a glance, one of the three state cards of the Dashboard tab: what is deployed (the LAST
 * REVISION, not the draft), its zones by state, how many zone members are protected (in an enforced zone with no
 * drift) and on which denominator, the drifts, and what the engine is doing, in plain words. One click opens the tab.
 */
export default function MicrosegSummaryCard({ connectionId, connectionName, onOpen }: Props) {
  const t = useTranslations('microsegPilot')
  const canWrite = useCanManageMicroseg(connectionId)
  const format = useFormatter()
  const { data: status, error: statusError, reload } = useMicrosegStatus(connectionId)
  const { data: policy, error: policyError, reload: reloadPolicy } = useMicrosegPolicy(connectionId)
  // The engine's memory of its last full run (no Proxmox call); the Dashboard's "To do" list reads the same key.
  const { data: drifts, error: driftsError } = useMicrosegDrifts(connectionId)
  // The status is polled, the policy read once: a deployment, a removal or a restore started anywhere else (another
  // browser, the API) moves the status' admin runs, and the deployed state is read again then (UA44).
  const runsMark = status ? adminRunsMark(status) : null
  const seenMark = useRef<string | null>(null)
  useEffect(() => {
    if (runsMark === null) return
    if (seenMark.current !== null && seenMark.current !== runsMark) void reloadPolicy()
    seenMark.current = runsMark
  }, [runsMark, reloadPolicy])
  const lastId = policy?.last_revision?.id
  const { revision } = useLastRevisionSnapshot(connectionId, lastId)
  const now = useNow(NOW_REFRESH_MS, status)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const { busy, error: confirmError, run, reset } = useDialogAction()

  const confirmWrites = async () => {
    const ok = await run(async () => {
      await microsegApi(connectionId).confirmWrites()
      await reload()
    })
    if (ok) setConfirmOpen(false)
  }

  const stopped = status?.emergency_stop ?? policy?.policy.emergency_stop ?? false
  const cov = status ? coverage(status) : null
  const unzoned = unzonedRunning(cov, drifts) ?? 0
  const checkedAt = status ? lastCheckAt(status) : null
  const pausedUntil = status?.engine.paused_until
  const held = !!status?.engine.held

  const deployment = (() => {
    if (stopped) {
      const label = clusterFirewallOff(status, policy) ? t('dashboard.deployment.stoppedFirewall') : t('dashboard.deployment.stopped')
      return <Chip size='small' color='error' label={label} sx={{ maxWidth: '100%' }} />
    }
    if (policyError && !policy) return <Typography variant='body2'>{t('dashboard.unavailable')}</Typography>
    if (!policy) return <Skeleton width={180} />
    if (!policy.last_revision) return <Typography variant='body2'>{t('dashboard.deployment.none')}</Typography>
    if (!revision?.snapshot) return <Typography variant='body2'>{t('dashboard.deployment.deployed')}</Typography>
    const { enforced, observing } = deployedCounts(revision.snapshot)
    return <Typography variant='body2'>{t('dashboard.deployment.counts', { enforced, observing })}</Typography>
  })()

  const protection = (() => {
    if (status && !cov) return <Typography variant='body2' color='text.secondary'>{t('waitingFirstCheck')}</Typography>
    if (!cov) return statusError ? <Typography variant='body2'>{t('dashboard.unavailable')}</Typography> : <Skeleton width={180} />
    if (cov.running === 0 && cov.members === 0) return <Typography variant='body2'>{t('dashboard.protection.none')}</Typography>
    return (
      <>
        <Typography variant='body2'>{t('dashboard.protection.protected', { protected: cov.protected, members: cov.members })}</Typography>
        <Typography variant='body2' color={unzoned > 0 ? 'warning.main' : 'text.secondary'}>
          {unzoned > 0 ? t('dashboard.protection.unzoned', { count: unzoned, running: cov.running }) : t('dashboard.protection.allZoned', { running: cov.running })}
        </Typography>
      </>
    )
  })()

  const zonesLine = (() => {
    const z = status?.zones_by_state
    if (!z) return null
    return <Typography variant='body2' color='text.secondary'>{t('dashboard.zones', { enforce: z.enforce ?? 0, observe: z.observe ?? 0, disabled: z.disabled ?? 0 })}</Typography>
  })()

  const driftsLine = (() => {
    if (!drifts) return driftsError ? <Typography variant='body2'>{t('dashboard.unavailable')}</Typography> : <Skeleton width={120} />
    if (!drifts.computed) return <Typography variant='body2' color='text.secondary'>{t('waitingFirstCheck')}</Typography>
    const count = drifts.drifts.length
    return <Typography variant='body2' color={count > 0 ? 'warning.main' : 'text.secondary'}>{count > 0 ? t('dashboard.drifts.count', { count }) : t('dashboard.drifts.none')}</Typography>
  })()

  const paused = stillPaused(pausedUntil, now) && !!pausedUntil

  const engineLine = (() => {
    if (!status) return statusError ? <Typography variant='body2'>{t('dashboard.unavailable')}</Typography> : <Skeleton width={180} />
    return (
      <>
        {held && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant='body2' color='warning.main'>{t('dashboard.engine.held')}</Typography>
            <WriteTip>
              <Button
                size='small'
                variant='outlined'
                color='warning'
                disabled={!canWrite}
                onClick={e => { e.stopPropagation(); reset(); setConfirmOpen(true) }}
              >
                {t('banner.confirmWrites')}
              </Button>
            </WriteTip>
          </Box>
        )}
        {paused && pausedUntil && <Typography variant='body2' color='warning.main'>{t('banner.pausedUntil', { time: formatWhen(format, pausedUntil) })}</Typography>}
        {!held && !paused && (
          <Typography variant='body2'>
            {checkedAt ? t('dashboard.engine.lastCheck', { time: format.relativeTime(checkedAt, now) }) : t('dashboard.engine.noCheck')}
          </Typography>
        )}
      </>
    )
  })()

  // Both reads in, or failed: until then one skeleton, never a row that says "nothing" from a missing answer.
  const settled = (!!status || !!statusError) && (!!policy || !!policyError)
  const notSetUp = !stopped && !!policy && policyNotSetUp(policy)
  let body = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <StateRow label={t('dashboard.deployment.label')}>{deployment}{zonesLine}</StateRow>
      <StateRow label={t('dashboard.protection.label')}>{protection}</StateRow>
      <StateRow label={t('dashboard.drifts.label')}>{driftsLine}</StateRow>
      <StateRow label={t('dashboard.engine.label')}>{engineLine}</StateRow>
    </Box>
  )
  if (notSetUp) {
    body = <Typography variant='body2' color='text.secondary' sx={{ minHeight: 38, display: 'flex', alignItems: 'center' }}>{t('dashboard.notSetUp')}</Typography>
  }

  let accent = STATE_GREY
  if (stopped) accent = STATE_RED
  else if (statusError && !status) accent = STATE_AMBER
  else if (held || paused) accent = STATE_AMBER
  else if (policy?.last_revision) accent = STATE_GREEN

  return (
    <MicrosegWriteContext.Provider value={canWrite}>
      <DashboardStateCard
        testId='microseg-card'
        icon='ri-shield-keyhole-line'
        title={t('tab.title')}
        subtitle={connectionName}
        accent={accent}
        onOpen={onOpen}
        openLabel={t('dashboard.openShort')}
        openAriaLabel={t('dashboard.open')}
        loading={!settled}
      >
        {body}
      </DashboardStateCard>
      <MicrosegConfirmDialog
        open={confirmOpen}
        title={t('banner.confirmWritesTitle')}
        body={t('banner.confirmWritesBody')}
        confirmLabel={t('banner.confirmWrites')}
        color='warning'
        busy={busy}
        error={confirmError}
        onConfirm={confirmWrites}
        onCancel={() => setConfirmOpen(false)}
      />
    </MicrosegWriteContext.Provider>
  )
}
