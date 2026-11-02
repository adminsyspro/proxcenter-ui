'use client'

import { useEffect, useId } from 'react'

import { Box, Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import { binaryUnit } from '@/lib/ceph/overview'

import { poolAvailReported, poolDotState, poolObjectsReported, RuleLink, type Pool, type StorageReadState } from './PoolParts'
import { Eyebrow, isTypingTarget, Row, StateDot, Tag, TABULAR, ThresholdBar, usePercent } from './ui'

/*
   Sheet of one pool, read only, in a centered modal: net fill,
   protection, CRUSH rule, PG count and target, autoscale mode, the PVE storages that
   use it, figures and the quotas when the pool has any. Up and down arrows move to the
   previous and next pool of the table.
*/

export interface PoolDrawerProps {
  pool: Pool
  /** Net fill of the pool as a 0..1 ratio. */
  fill: number
  ratios: { nearfull: number; full: number }
  rule: string
  storages: string[]
  storageState: StorageReadState
  hasPrev: boolean
  hasNext: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onRule: () => void
}

export default function PoolDrawer({ pool, fill, ratios, rule, storages, storageState, hasPrev, hasNext, onClose, onPrev, onNext, onRule }: PoolDrawerProps) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const percent = usePercent()
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const titleId = useId()
  const dot = poolDotState(fill, ratios)
  const subtitle = t('pools.drawer.subtitle', { app: pool.application, type: pool.type })
  const avail = poolAvailReported(pool, fill) ? pool.maxAvailFormatted : t('overview.missing')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTypingTarget(e.target)) return
      // Full screen and a focus inside the scrolling body: the arrows scroll the sheet, they do not walk the table.
      if (fullScreen || (e.target as Element | null)?.closest?.('.MuiDialogContent-root')) return
      if (e.key === 'ArrowDown' && hasNext) {
        e.preventDefault()
        onNext()
      } else if (e.key === 'ArrowUp' && hasPrev) {
        e.preventDefault()
        onPrev()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [fullScreen, hasPrev, hasNext, onPrev, onNext])

  const bytes = (n: number) => {
    const unit = binaryUnit(n)

    return `${format.number(n / unit.divisor, { maximumFractionDigits: 1 })} ${unit.unit}`
  }

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth='md' fullWidth fullScreen={fullScreen} slotProps={{ paper: { 'data-testid': 'pool-drawer' } as object }}>
      <DialogTitle component='div' id={`${titleId}-bar`} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          aria-hidden
          sx={{
            width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', fontSize: 18, flex: 'none',
            bgcolor: dot === 'error' ? 'error.main' : dot === 'warn' ? 'warning.main' : 'action.selected',
            color: dot === 'ok' ? 'text.secondary' : 'common.white',
          }}
        >
          <i className='ri-database-2-line' />
        </Box>
        {/* One line: the pool name, then its application and type. */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography id={titleId} component='h2' sx={{ fontSize: 15, fontWeight: 700, minWidth: 0, flexShrink: 1 }} noWrap title={pool.name}>{pool.name}</Typography>
          <Typography variant='body2' color='text.secondary' noWrap title={subtitle} sx={{ minWidth: 0, flexShrink: 2 }}>{subtitle}</Typography>
        </Box>
        <Tooltip title={t('pools.drawer.prev')}>
          <span><IconButton size='small' aria-label={t('pools.drawer.prev')} disabled={!hasPrev} onClick={onPrev}><i className='ri-arrow-up-s-line' /></IconButton></span>
        </Tooltip>
        <Tooltip title={t('pools.drawer.next')}>
          <span><IconButton size='small' aria-label={t('pools.drawer.next')} disabled={!hasNext} onClick={onNext}><i className='ri-arrow-down-s-line' /></IconButton></span>
        </Tooltip>
        <IconButton size='small' aria-label={t('pools.drawer.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, columnGap: 4, rowGap: 2, alignItems: 'start' }}>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
              <StateDot state={dot} size={8} />
              <Tag>{pool.application}</Tag>
              <Tag>{pool.type}</Tag>
            </Box>

            <Eyebrow><Box sx={{ mt: 2 }}>{t('pools.drawer.fill')}</Box></Eyebrow>
            <ThresholdBar value={fill} max={1} nearfull={ratios.nearfull} full={ratios.full} />
            <Typography variant='caption' color='text.secondary' sx={{ ...TABULAR, display: 'block' }}>
              {t('pools.drawer.fillDetail', { used: percent(fill, fill > 0 && fill < 0.01 ? 1 : 0), free: avail })}
            </Typography>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Row label={t('pools.drawer.storages')}>
              {storages.length > 0 ? storages.join(t('ui.listSeparator')) : <Box component='span' sx={{ color: 'text.secondary' }}>{t(storageState === 'loading' ? 'overview.missing' : storageState === 'error' ? 'pools.drawer.storagesUnavailable' : 'pools.drawer.storagesNone')}</Box>}
            </Row>
            <Row label={t('pools.drawer.protection')}>{t('pools.protection', { size: pool.size, min: pool.minSize })}</Row>
            <Row label={t('pools.drawer.rule')}><RuleLink name={rule} onOpen={onRule} /></Row>
            <Row label={t('pools.drawer.pgs')}>{format.number(pool.pgNum)}</Row>
            <Row label={t('pools.drawer.pgTarget')}>
              {pool.pgNumTarget !== pool.pgNum
                ? t('pools.drawer.pgTargetValue', { target: format.number(pool.pgNumTarget), current: format.number(pool.pgNum) })
                : format.number(pool.pgNumTarget)}
            </Row>
            <Row label={t('pools.drawer.autoscale')}>{pool.pgAutoscaleMode}</Row>
            {typeof pool.pgNumFinal === 'number' && pool.pgNumFinal > 0 && pool.pgNumFinal !== pool.pgNum && (
              <Row label={t('pools.drawer.pgRecommended')}>
                {typeof pool.pgNumIdeal === 'number' && pool.pgNumIdeal > 0
                  ? t('pools.drawer.pgRecommendedValue', { final: format.number(pool.pgNumFinal), ideal: format.number(Math.round(pool.pgNumIdeal)) })
                  : format.number(pool.pgNumFinal)}
              </Row>
            )}
            <Row label={t('pools.drawer.used')}>{pool.bytesUsedFormatted}</Row>
            <Row label={t('pools.drawer.avail')}>{avail}</Row>
            <Row label={t('pools.drawer.objects')}>{poolObjectsReported(pool) ? format.number(pool.objects) : t('overview.missing')}</Row>
            {typeof pool.quotaBytes === 'number' && pool.quotaBytes > 0 && <Row label={t('pools.drawer.quotaBytes')}>{bytes(pool.quotaBytes)}</Row>}
            {typeof pool.quotaObjects === 'number' && pool.quotaObjects > 0 && <Row label={t('pools.drawer.quotaObjects')}>{format.number(pool.quotaObjects)}</Row>}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
