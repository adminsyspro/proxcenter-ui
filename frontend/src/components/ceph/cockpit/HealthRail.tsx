'use client'

import { useMemo, useState } from 'react'

import { Box, ButtonBase, Card, Collapse, IconButton, Link, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import CephHealthCheckDetail from '@/components/ceph/CephHealthCheckDetail'
import { CephScopedFlagChips } from '@/components/ceph/CephFlagChips'
import type { CephOsdFlagsState } from '@/components/ceph/CephOsdFlags'
import { compareHealthChecks, healthTarget, type HealthTarget } from '@/lib/ceph/cephHealthLinks'
import { healthDetailMessages } from '@/lib/ceph/osdFlagsView'
import type { CephHealthIssue } from '@/lib/ceph/types'

import { Eyebrow, healthDot, softColor, targetLabel } from './ui'

/*
   Health rail of the cockpit, on every tab: the global state, the checks grouped
   errors first, each one with its detail folded and a link to the object it is
   about, and the OSD flags at the foot. On HEALTH_OK only the state and the
   flags remain.
*/

type RailFlags = Pick<CephOsdFlagsState, 'flags' | 'hostFlags' | 'osdFlags' | 'forbidden' | 'loading'>

export interface HealthRailProps {
  health: { status: string; checks: CephHealthIssue[] } | null
  flags: RailFlags
  onNavigate: (target: HealthTarget) => void
  onEditFlags: () => void
  /** Narrow screens: the checks fold under the state, which opens them. */
  collapsible?: boolean
  /** Changes when a link points at the flags: the foot pulses once. */
  flagsPulse?: number
  /** Wide screens: the card takes the height of its slot, the checks scroll inside and the flags foot stays at the bottom. */
  fill?: boolean
}

const STATE_ICON: Record<string, string> = {
  ok: 'ri-checkbox-circle-fill',
  warn: 'ri-alert-fill',
  error: 'ri-close-circle-fill',
  muted: 'ri-question-fill',
}

const STATE_COLOR = { ok: 'success', warn: 'warning', error: 'error', muted: 'info' } as const


function CheckRow({ check, onNavigate }: { check: CephHealthIssue; onNavigate: (target: HealthTarget) => void }) {
  const t = useTranslations('cephCockpit')
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const isError = check.severity === 'HEALTH_ERR'
  const target = healthTarget(check)
  const hasDetail = healthDetailMessages(check.detail).length > 0
  const label = target ? targetLabel(t, target) : null

  return (
    <Box
      data-testid='rail-check'
      data-code={check.name}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        columnGap: 1.25,
        alignItems: 'start',
        px: 2,
        py: 1.25,
        borderTop: '1px solid',
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        component='span'
        sx={{
          mt: '2px',
          px: 0.75,
          py: '2px',
          borderRadius: 0.75,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.03em',
          lineHeight: 1.4,
          whiteSpace: 'nowrap',
          bgcolor: softColor(theme, isError ? 'error' : 'warning', 0.12),
          color: isError ? 'error.main' : 'warning.dark',
          // The dark shade of amber is unreadable on a dark paper: the light one there.
          ...theme.applyStyles('dark', { color: isError ? 'error.light' : 'warning.light' }),
        }}
      >
        {isError ? t('rail.sevErr') : t('rail.sevWarn')}
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <Typography variant='body2' sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{check.name}</Typography>
          {hasDetail && (
            <IconButton
              size='small'
              aria-expanded={open}
              aria-label={open ? t('rail.hideDetail') : t('rail.showDetail')}
              onClick={() => setOpen(o => !o)}
              sx={{ p: 0.25, color: 'text.secondary' }}
            >
              <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
          {check.summary}
        </Typography>
        {hasDetail && (
          <Collapse in={open} unmountOnExit>
            <CephHealthCheckDetail detail={check.detail} />
          </Collapse>
        )}
      </Box>

      {target && label ? (
        <Link
          component='button'
          type='button'
          underline='hover'
          data-testid='rail-link'
          aria-label={t('rail.open', { target: label })}
          onClick={() => onNavigate(target)}
          sx={{
            mt: '1px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            maxWidth: 110,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Box>
          <i className='ri-arrow-right-line' aria-hidden style={{ fontSize: 14 }} />
        </Link>
      ) : (
        <span />
      )}
    </Box>
  )
}

function Group({ title, checks, onNavigate }: { title: string; checks: CephHealthIssue[]; onNavigate: (target: HealthTarget) => void }) {
  if (checks.length === 0) return null

  return (
    <Box>
      <Box data-testid='rail-group' sx={{ px: 2, pt: 1.25, pb: 0.5 }}>
        <Eyebrow>{title}</Eyebrow>
      </Box>
      {checks.map(check => <CheckRow key={check.name} check={check} onNavigate={onNavigate} />)}
    </Box>
  )
}

function FlagsFoot({ flags, onEditFlags, pulse }: { flags: RailFlags; onEditFlags: () => void; pulse?: number }) {
  const t = useTranslations('cephCockpit')
  const theme = useTheme()
  const any = flags.flags.length > 0 || Object.keys(flags.hostFlags).length > 0 || Object.keys(flags.osdFlags).length > 0

  if (flags.forbidden) return null

  return (
    <Box
      key={pulse}
      data-testid='rail-flags'
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        px: 2,
        py: 1.5,
        mt: 'auto',
        flex: 'none',
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        ...(pulse !== undefined && pulse > 0 && {
          '@keyframes railFlagsPulse': {
            '0%, 50%': { boxShadow: `inset 0 0 0 2px ${softColor(theme, 'info', 0.5)}` },
            '100%': { boxShadow: 'inset 0 0 0 2px transparent' },
          },
          animation: 'railFlagsPulse 2.4s ease-out',
        }),
      }}
    >
      <Box component='i' className='ri-flag-line' aria-hidden sx={{ fontSize: 16, color: 'text.secondary', mt: '1px' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {any ? (
          <>
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 0.25 }}>{t('rail.flags')}</Typography>
            <CephScopedFlagChips globalFlags={flags.flags} hostFlags={flags.hostFlags} osdFlags={flags.osdFlags} stacked />
          </>
        ) : (
          <Typography variant='body2' color='text.secondary'>{t('rail.flagsNone')}</Typography>
        )}
      </Box>
      <Link component='button' type='button' underline='hover' onClick={onEditFlags} sx={{ fontSize: 12, fontWeight: 600, mt: '2px' }}>
        {t('rail.editFlags')}
      </Link>
    </Box>
  )
}

export default function HealthRail({ health, flags, onNavigate, onEditFlags, collapsible = false, flagsPulse, fill = false }: HealthRailProps) {
  const t = useTranslations('cephCockpit')
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const state = healthDot(health?.status)
  const stateColor = STATE_COLOR[state]

  const { errors, warnings } = useMemo(() => {
    const checks = health?.checks ?? []

    return {
      errors: checks.filter(c => c.severity === 'HEALTH_ERR').sort(compareHealthChecks),
      warnings: checks.filter(c => c.severity !== 'HEALTH_ERR').sort(compareHealthChecks),
    }
  }, [health])

  const hasChecks = errors.length + warnings.length > 0

  const stateLabel = health?.status && ['HEALTH_OK', 'HEALTH_WARN', 'HEALTH_ERR'].includes(health.status)
    ? t(`health.${health.status}`)
    : t('health.unknown')

  const top = (
    <Box
      sx={{
        width: '100%',
        flexShrink: 0,
        textAlign: 'left',
        p: 2,
        background: state === 'muted'
          ? undefined
          : `linear-gradient(180deg, ${softColor(theme, stateColor, 0.08)}, transparent)`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <img src='/images/ceph-logo.svg' alt='' width={18} height={18} data-testid='rail-logo' />
          <Eyebrow>{t('rail.title')}</Eyebrow>
        </Box>
        <Box
          data-testid='rail-state'
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', flex: 'none', fontSize: 15, fontWeight: 800, lineHeight: 1.3, color: state === 'muted' ? 'text.secondary' : `${stateColor}.main` }}
        >
          <i className={STATE_ICON[state]} aria-hidden style={{ fontSize: 18 }} />
          <span>{stateLabel}</span>
          {collapsible && hasChecks && (
            <Box component='i' className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} aria-hidden sx={{ fontSize: 20, color: 'text.secondary' }} />
          )}
        </Box>
      </Box>
    </Box>
  )

  const groups = hasChecks && (
    <Box data-testid='rail-checks' sx={fill ? { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } : undefined}>
      <Group title={t('rail.errors')} checks={errors} onNavigate={onNavigate} />
      <Group title={t('rail.warnings')} checks={warnings} onNavigate={onNavigate} />
    </Box>
  )

  return (
    <Card variant='outlined' data-testid='health-rail' sx={{ overflow: 'hidden', ...(fill && { height: '100%', display: 'flex', flexDirection: 'column' }) }}>
      {collapsible && hasChecks ? (
        <ButtonBase
          aria-expanded={open}
          aria-label={open ? t('rail.hideChecks') : t('rail.showChecks')}
          onClick={() => setOpen(o => !o)}
          sx={{ display: 'block', width: '100%' }}
        >
          {top}
        </ButtonBase>
      ) : top}
      {collapsible ? <Collapse in={open} unmountOnExit>{groups}</Collapse> : groups}
      <FlagsFoot flags={flags} onEditFlags={onEditFlags} pulse={flagsPulse} />
    </Card>
  )
}
