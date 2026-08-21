'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { Box, CircularProgress, Divider, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import QuotaDonut from './QuotaDonut'
import MyVmsMetricsCharts from './MyVmsMetricsCharts'
import MyGreenCard from './MyGreenCard'
import MyDatacentersMapCard from './MyDatacentersMapCard'

interface Props {
  vdc: any
  onRefresh?: () => void
  refreshing?: boolean
}

/**
 * Tenant cockpit for a single vDC: quotas → DC map → per-VM consumption
 * charts → green footprint. Resource management (VMs, VNets, storages,
 * backups) lives in /infrastructure/inventory; this view focuses on the
 * usage signals tenants actually care about day-to-day.
 */
export default function MyVdcOverview({ vdc, onRefresh, refreshing = false }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const accent = theme.palette.primary.main
  const usage = vdc.usage || {}
  const quota = vdc.quota || {}
  const unlimitedLabel = t('vdc.quotaUnlimited')
  const formatMbAsGb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`

  const connectionIds = useMemo<string[]>(
    () => (vdc.connectionId ? [vdc.connectionId] : []),
    [vdc.connectionId],
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Block 1: Quota donuts — glassmorphism with subtle highlight */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          position: 'relative',
          overflow: 'hidden',
          background: `linear-gradient(135deg, ${alpha(accent, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(accent, 0.03)} 100%)`,
          borderColor: alpha(accent, 0.3),
          backdropFilter: 'blur(8px)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
          '&:hover': {
            borderColor: alpha(accent, 0.5),
            boxShadow: `0 8px 32px ${alpha(accent, 0.15)}`,
          },
        }}
      >
        {/* Top-right highlight blob — the "reflet" */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: -50,
            right: -50,
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(accent, 0.12)} 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />
        <Box sx={{ position: 'relative' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-gauge-line" />
              {t('myVdc.quotas')}
            </Typography>
            {onRefresh && (
              <Tooltip title={t('common.refresh')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={onRefresh}
                    disabled={refreshing}
                    aria-label={t('common.refresh')}
                  >
                    {refreshing
                      ? <CircularProgress size={16} thickness={5} />
                      : <i className="ri-refresh-line" style={{ fontSize: 18 }} />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              // 7 quota donuts now (vCPU, RAM, Storage, VMs, VNets,
              // Snapshots, Backups). 2 cols on phones, 4 on tablets,
              // a single row of 7 on desktop so the cockpit fits in one
              // glance without scrolling sideways.
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)', md: 'repeat(7, 1fr)' },
              justifyItems: 'center',
            }}
          >
            <QuotaDonut icon="ri-cpu-line" label={t('vdc.maxVcpus')} used={usage.usedVcpus || 0} max={quota.maxVcpus} unlimitedLabel={unlimitedLabel} />
            <QuotaDonut
              icon="ri-ram-2-line"
              label={t('vdc.maxRam')}
              used={usage.usedRamMb || 0}
              max={quota.maxRamMb ?? null}
              formatValue={formatMbAsGb}
              unlimitedLabel={unlimitedLabel}
            />
            <QuotaDonut
              icon="ri-hard-drive-2-line"
              label={t('vdc.maxStorage')}
              used={usage.usedStorageMb || 0}
              max={quota.maxStorageMb ?? null}
              formatValue={formatMbAsGb}
              unlimitedLabel={unlimitedLabel}
            />
            <QuotaDonut icon="ri-computer-line" label={t('vdc.maxVms')} used={usage.usedVms || 0} max={quota.maxVms} unlimitedLabel={unlimitedLabel} />
            <QuotaDonut icon="ri-git-branch-line" label={t('vdc.maxVnets')} used={(vdc.vnets || []).length} max={quota.maxVnets} unlimitedLabel={unlimitedLabel} />
            <QuotaDonut
              icon="ri-camera-lens-line"
              label={t('vdc.maxSnapshots')}
              used={usage.usedSnapshots || 0}
              max={quota.maxSnapshots ?? null}
              unlimitedLabel={unlimitedLabel}
            />
            <QuotaDonut
              icon="ri-archive-line"
              label={t('vdc.maxBackups')}
              used={usage.usedBackups || 0}
              max={quota.maxBackups ?? null}
              unlimitedLabel={unlimitedLabel}
            />
          </Box>

          {/* Per-tier storage usage: one bar per storage policy attached to
              this vDC that carries its own quota (quotaMb != null). Policies
              without a quota share the global storage donut above and get no
              bar here; usedStorageByStorage is keyed by storageId and can be
              absent for a tier with no usage yet, hence the ?? 0. */}
          {vdc.storagePolicies?.some((sp: any) => sp.quotaMb != null) && (
            <>
              {/* Visible separator: the tiers are a sub-section of the quota
                  card, not an eighth donut. Accent-tinted like the card's own
                  border so it reads on the glass gradient in both themes. */}
              <Divider sx={{ mt: 2.5, mb: 2, borderColor: alpha(accent, 0.25) }} />
              <Box>
                <Typography
                  variant="subtitle2"
                  sx={{ fontWeight: 600, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <Box component="i" className="ri-hard-drive-2-line" sx={{ fontSize: 16, color: 'primary.main' }} />
                  {t('myVdc.storageTiersTitle')}
                </Typography>
                {vdc.storagePolicies
                  .filter((sp: any) => sp.quotaMb != null)
                  .map((sp: any) => {
                    const usedMb = usage.usedStorageByStorage?.[sp.storageId] ?? 0
                    const pct = Math.min(100, Math.round((usedMb / sp.quotaMb) * 100))
                    // The bar clamps at 100 %, so a tier already over its
                    // quota is indistinguishable from one exactly at it:
                    // the alert icon carries that difference. Decorative,
                    // the used/quota figures next to it already say it.
                    const over = usedMb > sp.quotaMb

                    return (
                      <Box key={sp.policyId} sx={{ mt: 1.5 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                          <Box
                            component="i"
                            className="ri-database-2-line"
                            sx={{ fontSize: 14, color: 'text.secondary' }}
                          />
                          <Typography variant="caption">{t('myVdc.storageTierUsage', { policy: sp.name })}</Typography>
                          <Box sx={{ flexGrow: 1 }} />
                          {over && (
                            <Box
                              aria-hidden
                              component="i"
                              className="ri-alarm-warning-line"
                              sx={{ fontSize: 14, color: 'error.main' }}
                            />
                          )}
                          <Typography variant="caption" color={over ? 'error.main' : 'text.secondary'}>
                            {formatMbAsGb(usedMb)} / {formatMbAsGb(sp.quotaMb)}
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          color={pct >= 90 ? 'error' : 'primary'}
                          sx={{ height: 6, borderRadius: 1 }}
                        />
                      </Box>
                    )
                  })}
              </Box>
            </>
          )}
        </Box>
      </Paper>

      {/* Per-VM consumption charts — CPU%, RAM%, Network in+out, Disk r/w
          over the last hour. The full VM list and VNet management have been
          relocated to /infrastructure/inventory; the tenant cockpit here
          stays focused on usage signals (quotas, consumption, footprint). */}
      <MyVmsMetricsCharts connectionIds={connectionIds} />

      {/* Geographic map of datacentres hosting the vDC's resources — placed
          after the metric charts so the cockpit reads top-to-bottom from
          live consumption to compliance/residency context. */}
      <MyDatacentersMapCard vdcId={vdc.id} />

      {/* Green-IT card at the bottom — full width so the 3 sub-papers have
          room without clipping. */}
      <MyGreenCard vdcId={vdc.id} />
    </Box>
  )
}
