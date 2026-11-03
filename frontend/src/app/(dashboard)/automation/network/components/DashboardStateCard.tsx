'use client'

import { Box, Button, Card, CardContent, Skeleton, Tooltip, Typography, alpha } from '@mui/material'

export const STATE_GREEN = '#22c55e'
export const STATE_AMBER = '#f59e0b'
export const STATE_RED = '#ef4444'
export const STATE_GREY = '#94a3b8'

type Props = {
  testId: string
  icon: string
  title: string
  /** Shown after the title, ellipsed (a connection name). */
  subtitle?: string
  /** Colour of the state: green fine, amber to look at, red off or stopped, grey unknown or loading. */
  accent: string
  /** Opens the tab the card summarises; the whole card is clickable. */
  onOpen?: () => void
  openLabel?: string
  /** Accessible name of the open button, when the short label is not enough. */
  openAriaLabel?: string
  /** Something to do inside the card (a refresh button): its clicks do not open the tab. */
  headerAction?: React.ReactNode
  loading?: boolean
  children: React.ReactNode
}

/** Same footprint as the figures: three label and value pairs. */
export function StateCardSkeleton({ testId }: { testId: string }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {[0, 1, 2].map(i => (
        <Box key={i}>
          <Skeleton width={90} height={16} />
          <Skeleton width='70%' height={22} />
        </Box>
      ))}
    </Box>
  )
}

/**
 * One state card of the Dashboard (cluster firewall, micro-segmentation, guest coverage): the same family for the
 * three, an accent bar, an icon, a title, a way to open the tab, and the figures below.
 */
export default function DashboardStateCard({ testId, icon, title, subtitle, accent, onOpen, openLabel, openAriaLabel, headerAction, loading, children }: Props) {
  return (
    <Card
      data-testid={testId}
      onClick={onOpen}
      sx={{
        height: '100%',
        cursor: onOpen ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${alpha(accent, 0.12)} 0%, ${alpha(accent, 0.04)} 100%)`,
        border: `1px solid ${alpha(accent, 0.3)}`,
        transition: 'box-shadow 0.2s',
        '&:hover': onOpen ? { boxShadow: `0 8px 24px ${alpha(accent, 0.2)}` } : undefined,
        '&::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: accent },
      }}
    >
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: alpha(accent, 0.2), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className={icon} style={{ fontSize: 20, color: accent }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flex: 1, minWidth: 0 }}>
            <Typography variant='subtitle1' sx={{ fontWeight: 700, flexShrink: 0 }}>{title}</Typography>
            {subtitle && (
              <Tooltip title={subtitle}>
                <Typography variant='body2' color='text.secondary' noWrap data-testid={`${testId}-subtitle`}>{subtitle}</Typography>
              </Tooltip>
            )}
          </Box>
          {headerAction && <Box onClick={e => e.stopPropagation()} sx={{ flexShrink: 0 }}>{headerAction}</Box>}
          {onOpen && openLabel && (
            <Button
              size='small'
              aria-label={openAriaLabel ?? openLabel}
              onClick={e => { e.stopPropagation(); onOpen() }}
              endIcon={<i className='ri-arrow-right-line' />}
              sx={{ flexShrink: 0 }}
            >
              {openLabel}
            </Button>
          )}
        </Box>
        {loading ? <StateCardSkeleton testId={`${testId}-loading`} /> : children}
      </CardContent>
    </Card>
  )
}

/** A label above its value, the row of every state card. */
export function StateRow({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ minWidth: 0 }}>
      <Typography variant='caption' component='div' sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}
