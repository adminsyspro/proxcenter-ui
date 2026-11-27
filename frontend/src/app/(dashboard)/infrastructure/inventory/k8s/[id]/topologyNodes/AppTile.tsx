'use client'
import { Card, CardActionArea, Box, Typography, Chip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import type { AppSummary } from '@/lib/k8s/appGrid'

const HEALTH_COLOR: Record<AppSummary['health'], string> = {
  healthy: '#4caf50',
  degraded: '#ff9800',
  error: '#f44336',
}

function kindCountsLine(kindCounts: Record<string, number>): string {
  return Object.entries(kindCounts)
    .map(([kind, count]) => `${count} ${kind}${count > 1 ? 's' : ''}`)
    .join(' · ')
}

export function AppTile({ app, onOpen }: { app: AppSummary; onOpen: (key: string) => void }) {
  const t = useTranslations('kubernetes.topology')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 'var(--proxcenter-card-radius, 12px)',
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)',
      }}
    >
      <CardActionArea
        onClick={() => onOpen(app.key)}
        sx={{ p: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.75 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%' }}>
          <Box
            role="status"
            aria-label={t(`apps.health.${app.health}`)}
            sx={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', bgcolor: HEALTH_COLOR[app.health], flexShrink: 0 }}
          />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {app.label}
          </Typography>
        </Box>

        {app.namespace && (
          <Chip
            label={app.namespace}
            size="small"
            variant="outlined"
            sx={{ alignSelf: 'flex-start', fontSize: '0.7rem', height: '1.25rem' }}
          />
        )}

        {Object.keys(app.kindCounts).length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
            {kindCountsLine(app.kindCounts)}
          </Typography>
        )}

        {app.podsTotal > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
            {t('apps.pods', { healthy: app.podsHealthy, total: app.podsTotal })}
          </Typography>
        )}
      </CardActionArea>
    </Card>
  )
}
