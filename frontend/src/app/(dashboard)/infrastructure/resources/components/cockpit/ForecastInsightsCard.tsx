'use client'

import { useState } from 'react'

import { Box, Chip, Collapse, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import PagedRows from '@/components/ui/PagedRows'
import { isNPlusOneItem, type ForecastInsights, type ForecastOutlookItem, type ForecastRisk } from '@/lib/resources/forecastInsights'

import { ClusterIcon } from '../../../inventory/components/TreeIcons'
import type { NodeCapacity } from '../../types'
import { COLORS } from '../../constants'
import AiReadingCard from './AiReadingCard'
import { Conclusion, EmptyState, formatDays } from './ui'

const RISK_COLOR: Record<ForecastRisk, string> = { high: COLORS.error, medium: COLORS.warning, low: COLORS.info }

function OutlookRow({ item, nodes, describe }: {
  item: ForecastOutlookItem
  nodes: NodeCapacity[]
  describe: (item: ForecastOutlookItem) => { scope: string; explanation: string; action: string }
}) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const color = RISK_COLOR[item.risk]
  const { scope, explanation, action } = describe(item)
  const clusterNodes = nodes.filter(n => n.connectionName === item.name).map(n => ({ status: n.online ? 'online' : 'offline' }))

  let icon = <i className="ri-global-line" style={{ fontSize: 15, opacity: 0.7 }} />
  if (item.kind === 'cluster') icon = <ClusterIcon nodes={clusterNodes} />
  if (item.kind === 'pool') icon = <i className={item.node ? 'ri-hard-drive-2-line' : 'ri-share-line'} style={{ fontSize: 15, opacity: 0.7 }} />

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} onClick={() => setOpen(prev => !prev)} sx={{ py: 0.75, cursor: 'pointer' }}>
        <Box sx={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>{icon}</Box>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ width: { xs: 'auto', md: 220 }, flex: { xs: 1, md: 'none' }, minWidth: 0 }}>{scope}</Typography>
        <Chip size="small" variant="outlined" label={isNPlusOneItem(item) ? 'N+1' : t(`resources.cockpit.resource.${item.resource}`)} sx={{ width: 84, flexShrink: 0 }} />
        <Typography variant="body2" sx={{ width: 56, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>{Math.round(item.pct)}%</Typography>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ width: 110, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>{formatDays(t, item.days)}</Typography>
        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, display: { xs: 'none', md: 'block' } }}>{action}</Typography>
        <Chip size="small" label={t(`resources.forecastAi.risk.${item.risk}`)} sx={{ flexShrink: 0, fontWeight: 600, bgcolor: alpha(color, 0.12), color }} />
        <IconButton size="small" aria-expanded={open} aria-label={t(open ? 'resources.cockpit.collapse' : 'resources.cockpit.expand')}>
          <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18 }} />
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={0.75} sx={{ pl: 4.5, pr: 1, pb: 1.5 }}>
          <Conclusion explanation={explanation} action={action} />
        </Stack>
      </Collapse>
    </Box>
  )
}

export default function ForecastInsightsCard({ insights, loading, failed, onRegenerate, nodes, isAllScope }: {
  insights: ForecastInsights | null
  loading: boolean
  failed: boolean
  onRegenerate: () => void
  nodes: NodeCapacity[]
  isAllScope: boolean
}) {
  const t = useTranslations()
  const isBasic = insights?.provider === 'basic'

  const summary = (() => {
    if (!insights) return ''
    if (!isBasic || !insights.summaryKey) return insights.summary

    return t(`resources.forecastAi.${insights.summaryKey}`, insights.summaryParams ?? {})
  })()

  const describe = (item: ForecastOutlookItem) => {
    const where = item.node ? `${item.name} (${item.node})` : item.name
    const scope = item.kind === 'estate' && isAllScope ? t('resources.forecastAi.estate') : where
    const params = {
      ...item.params,
      name: scope,
      cluster: item.cluster ?? '',
      pct: Math.round(item.pct),
      days: item.days ?? 0,
      resource: t(`resources.cockpit.resource.${item.resource}`),
    }

    return {
      scope,
      explanation: item.explanationKey ? t(`resources.forecastAi.${item.explanationKey}`, params) : item.explanation,
      action: item.actionKey ? t(`resources.forecastAi.${item.actionKey}`, params) : item.action,
    }
  }

  const confidence = insights && (
    <Tooltip title={t('resources.forecastAi.confidenceHint', { days: insights.historyDays })} arrow>
      <Chip
        size="small"
        variant="outlined"
        icon={<i className="ri-database-line" style={{ fontSize: 14 }} />}
        label={t(`resources.forecastAi.confidence.${insights.dataConfidence}`, { days: insights.historyDays })}
        sx={{ cursor: 'help' }}
      />
    </Tooltip>
  )

  return (
    <AiReadingCard
      icon="ri-sparkling-line"
      title={t('resources.forecastAi.title')}
      idleSubtitle={t('resources.forecastAi.subtitle')}
      pendingTitle={t('resources.forecastAi.pendingTitle')}
      pendingHint={t('resources.forecastAi.analysing')}
      reading={insights}
      summary={summary}
      loading={loading}
      failed={failed}
      onRegenerate={onRegenerate}
      extraAction={confidence}
    >
      {insights && (insights.outlook.length === 0 ? (
        <EmptyState icon="ri-checkbox-circle-line" text={t('resources.forecastAi.nothing')} />
      ) : (
        <PagedRows items={insights.outlook}>
          {item => <OutlookRow key={`${item.ref}:${item.resource}:${item.explanationKey ?? ''}`} item={item} nodes={nodes} describe={describe} />}
        </PagedRows>
      ))}
    </AiReadingCard>
  )
}
