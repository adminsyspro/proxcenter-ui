'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Tooltip, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { LoadBar } from '@/components/HostDrainDialog'
import { NodeGlyph } from '@/components/automation/drs/glyphs'
import { BULK_PROJECTION_MEM_ALERT, bulkProjectionMemAlerts, type BulkNodeProjection } from '../bulkLoadProjection'

const GB = 1024 ** 3
// The drain dialog's thresholds: memory against its default 90 % ceiling, CPU against the node's cores.
const MEM_LIMIT = BULK_PROJECTION_MEM_ALERT
const CPU_LIMIT = 1

/**
 * Load of each target node now and once the batch has landed (roadmap#53 part
 * B), drawn like the host-drain projection (#248). Past 90 % of a node's
 * memory, a warning: the launch stays possible, the operator decides.
 */
export default function BulkLoadProjectionBlock({ rows, nodeStatus }: Readonly<{ rows: BulkNodeProjection[]; nodeStatus: Record<string, string | undefined> }>) {
  const t = useTranslations('inventoryPage.esxiMigration')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const alerts = bulkProjectionMemAlerts(rows)
  const ratio = (v: number, total: number) => (total > 0 ? v / total : 0)
  const help = t('loadProjectionHelp')

  return (
    <Box data-testid="bulk-load-projection">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={600}>{t('loadProjectionTitle')}</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={help}>
          <Box component="i" className="ri-information-line" aria-label={help} sx={{ fontSize: 15, color: 'text.secondary', cursor: 'help' }} />
        </Tooltip>
      </Box>
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.75 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(90px, auto) 1fr 1fr', columnGap: 2, rowGap: 0.75, alignItems: 'center' }}>
          <Box />
          <Typography variant="caption" color="text.secondary">{t('loadProjectionMem')}</Typography>
          <Typography variant="caption" color="text.secondary">{t('loadProjectionCpu')}</Typography>
          {rows.map(r => (
            <React.Fragment key={r.node}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }} data-testid={`bulk-projection-node-${r.node}`}>
                <NodeGlyph status={nodeStatus[r.node]} dark={isDark} dotBorder={dotBorder} />
                <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>{r.node}</Typography>
                {r.guests_in > 0 && (
                  <Tooltip title={t('loadProjectionIncoming', { count: r.guests_in, vcpus: r.vcpus_in })}>
                    <Typography variant="caption" color="text.secondary" noWrap>{`+${r.guests_in}`}</Typography>
                  </Tooltip>
                )}
              </Box>
              {r.known ? (
                <>
                  <LoadBar before={ratio(r.mem_before, r.mem_total)} after={ratio(r.mem_after, r.mem_total)} limit={MEM_LIMIT} testId={`bulk-projection-mem-${r.node}`} />
                  <LoadBar before={r.cpu_before} after={r.cpu_after} limit={CPU_LIMIT} testId={`bulk-projection-cpu-${r.node}`} />
                </>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ gridColumn: 'span 2' }}>{t('loadProjectionUnknown')}</Typography>
              )}
            </React.Fragment>
          ))}
        </Box>
      </Box>
      {alerts.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }} data-testid="bulk-projection-mem-alert">
          {alerts.map(r => (
            <Typography key={r.node} variant="body2" sx={{ fontSize: 12 }}>
              {t('loadProjectionMemAlert', {
                node: r.node,
                pct: Math.round(ratio(r.mem_after, r.mem_total) * 100),
                used: (r.mem_after / GB).toFixed(1),
                total: (r.mem_total / GB).toFixed(1),
              })}
            </Typography>
          ))}
        </Alert>
      )}
    </Box>
  )
}
