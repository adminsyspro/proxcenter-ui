'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Box, Tooltip } from '@mui/material'

import { useActiveBulkBatches } from '@/hooks/useActiveBulkBatches'
import { bulkBatchInventoryUrl, bulkBatchSourceLogo, requestOpenBulkBatch } from '@/lib/migration/bulkBatchOpen'

/**
 * One taskbar entry per bulk migration still running or paused (roadmap#53),
 * on every page: minimizing the follow-up dialog no longer means going back to
 * the source host to find it. A click reopens the follow-up, in place on the
 * Inventory page or by navigating to the source host.
 *
 * Drawn as a tab of the taskbar, the same family as the "Proxmox | ProxCenter"
 * group next to it (border, radius, height, type, hover), with a 2 px progress
 * line along its bottom edge.
 */
export default function ActiveBulkBatchChips() {
  const t = useTranslations()
  const router = useRouter()
  const { data } = useActiveBulkBatches()
  const batches = (data?.data ?? []).filter(b => b.status === 'running' || b.status === 'paused')
  if (batches.length === 0) return null

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }} data-testid="active-bulk-batches">
      {batches.map(b => {
        const done = b.counts.completed + b.counts.failed + b.counts.cancelled
        const paused = b.status === 'paused'
        const pct = b.total > 0 ? Math.round((done / b.total) * 100) : 0
        return (
          <Tooltip key={b.id} title={t('tasks.openBulkMigration')}>
            <Box
              role="button"
              tabIndex={0}
              data-testid={`active-bulk-batch-${b.id}`}
              onClick={(e) => {
                // The taskbar header toggles the panel on click.
                e.stopPropagation()
                if (!requestOpenBulkBatch(b.id, b.sourceConnectionId)) router.push(bulkBatchInventoryUrl(b.id, b.sourceConnectionId))
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click() } }}
              sx={{
                position: 'relative', overflow: 'hidden',
                display: 'flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.25, borderRadius: 1, border: '1px solid rgba(231,227,252,0.15)',
                cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
                opacity: 0.8,
                '&:hover, &:focus-visible': { opacity: 1, bgcolor: 'rgba(231,227,252,0.12)', outline: 'none' },
              }}
            >
              <img src={bulkBatchSourceLogo(b.sourceType)} alt="" style={{ height: 14, width: 'auto' }} />
              {t('tasks.bulkMigration', { count: b.total })}
              <Box component="span" sx={{ opacity: 0.7 }}>{done}/{b.total}</Box>
              {paused && (
                <>
                  <Box component="i" className="ri-pause-line" sx={{ color: 'warning.main', fontSize: 14 }} />
                  <Box component="span" sx={{ color: 'text.secondary' }}>{t('tasks.bulkMigrationPaused')}</Box>
                </>
              )}
              <Box
                data-testid={`active-bulk-batch-progress-${b.id}`}
                sx={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: `${pct}%`, bgcolor: paused ? 'warning.main' : 'primary.main' }}
              />
            </Box>
          </Tooltip>
        )
      })}
    </Box>
  )
}
