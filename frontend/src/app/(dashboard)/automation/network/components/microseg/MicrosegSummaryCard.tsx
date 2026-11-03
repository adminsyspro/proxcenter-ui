'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, Button, Card, CardContent, Chip, Skeleton, Tooltip, Typography, alpha } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import { coverage } from './coverage'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { useDialogAction } from './dialogParts'
import { MicrosegWriteContext, WriteTip, useCanManageMicroseg } from './microsegAccess'
import { adminRunsMark, clusterFirewallOff, deployedCounts, formatWhen, lastCheckAt, policyNotSetUp, stillPaused } from './summaryModel'
import { NOW_REFRESH_MS, useNow } from './useNow'

type Props = {
  connectionId: string
  /** Shown next to the title: the card is about this connection only. */
  connectionName?: string
  /** Opens the Micro-segmentation tab. */
  onOpen: () => void
}

const GREEN = '#22c55e'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const GREY = '#94a3b8'

function Row({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
      <Box component='i' className={icon} aria-hidden sx={{ fontSize: 18, mt: 0.25, color: 'text.secondary' }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant='caption' component='div' sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        {children}
      </Box>
    </Box>
  )
}

/**
 * The Micro-segmentation at a glance, for the Dashboard tab: what is deployed (the LAST REVISION, not the draft),
 * how many guests are protected, and what the engine is doing, in plain words. One click opens the tab.
 */
export default function MicrosegSummaryCard({ connectionId, connectionName, onOpen }: Props) {
  const t = useTranslations('microsegPilot')
  const canWrite = useCanManageMicroseg(connectionId)
  const format = useFormatter()
  const { data: status, error: statusError, reload } = useMicrosegStatus(connectionId)
  const { data: policy, error: policyError, reload: reloadPolicy } = useMicrosegPolicy(connectionId)
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
  const unzoned = cov ? cov.running - cov.zoned : 0
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
          {unzoned > 0 ? t('dashboard.protection.unzoned', { count: unzoned }) : t('dashboard.protection.allZoned')}
        </Typography>
      </>
    )
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
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2.5 }}>
      <Row icon='ri-rocket-line' label={t('dashboard.deployment.label')}>{deployment}</Row>
      <Row icon='ri-shield-check-line' label={t('dashboard.protection.label')}>{protection}</Row>
      <Row icon='ri-settings-3-line' label={t('dashboard.engine.label')}>{engineLine}</Row>
    </Box>
  )
  if (!settled) {
    body = (
      <Box data-testid='microseg-card-loading' sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2.5 }}>
        {[0, 1, 2].map(i => (
          <Box key={i}>
            <Skeleton width={90} height={16} />
            <Skeleton width={180} height={22} />
          </Box>
        ))}
      </Box>
    )
  } else if (notSetUp) {
    body = <Typography variant='body2' color='text.secondary' sx={{ minHeight: 38, display: 'flex', alignItems: 'center' }}>{t('dashboard.notSetUp')}</Typography>
  }

  let accent = GREY
  if (stopped) accent = RED
  else if (statusError && !status) accent = AMBER
  else if (held || paused) accent = AMBER
  else if (policy?.last_revision) accent = GREEN

  return (
    <MicrosegWriteContext.Provider value={canWrite}>
      <Card
        onClick={onOpen}
        sx={{
          mb: 3,
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
          background: `linear-gradient(135deg, ${alpha(accent, 0.12)} 0%, ${alpha(accent, 0.05)} 100%)`,
          border: `1px solid ${alpha(accent, 0.3)}`,
          transition: 'all 0.2s',
          '&:hover': { boxShadow: `0 8px 24px ${alpha(accent, 0.2)}` },
          '&::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: accent },
        }}
      >
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: alpha(accent, 0.2), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className='ri-shield-keyhole-line' style={{ fontSize: 20, color: accent }} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flex: 1, minWidth: 0 }}>
              <Typography variant='subtitle1' sx={{ fontWeight: 700, flexShrink: 0 }}>{t('tab.title')}</Typography>
              {connectionName && (
                <Tooltip title={connectionName}>
                  <Typography variant='body2' color='text.secondary' noWrap data-testid='microseg-card-connection'>{connectionName}</Typography>
                </Tooltip>
              )}
            </Box>
            <Button
              size='small'
              aria-label={t('dashboard.open')}
              onClick={e => { e.stopPropagation(); onOpen() }}
              endIcon={<i className='ri-arrow-right-line' />}
              sx={{ flexShrink: 0 }}
            >
              {t('dashboard.openShort')}
            </Button>
          </Box>
          {body}
        </CardContent>
      </Card>
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
