'use client'

import { Card, CardActionArea, CardContent, Box, Typography, Chip, Stack, IconButton, CircularProgress, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import { UTIL_GRADIENT_CSS } from '@/lib/k8s/metrics'
import { isIntegrating } from '@/lib/k8s/clusterHealthStatus'
import { distroLogo } from '@/lib/k8s/distros'

export type K8sHealthState = 'healthy' | 'degraded' | 'unreachable' | 'auth_failed' | 'stale' | 'unknown'

export type K8sClusterRow = {
  id: string
  name: string
  distro?: string
  source?: string
  apiServerUrl?: string
  version?: string | null
  healthState?: K8sHealthState
  healthDetail?: { nodesReady?: number; nodesTotal?: number } | null
  lastHealthAt?: string | null
  proxmoxConnectionId?: string | null
}

/** Map a health state to a MUI chip color. Reused by ClusterDetail. */
export function healthChipColor(state?: K8sHealthState): 'success' | 'warning' | 'error' | 'default' {
  switch (state) {
    case 'healthy':
      return 'success'
    case 'degraded':
    case 'stale':
      return 'warning'
    case 'unreachable':
    case 'auth_failed':
      return 'error'
    default:
      return 'default'
  }
}

/** Hex status-dot colour for the overlaid pastille (matches InventoryTree). */
export function healthDotColor(state?: K8sHealthState): string {
  switch (state) {
    case 'healthy': return '#4caf50'
    case 'degraded':
    case 'stale': return '#ff9800'
    case 'unreachable':
    case 'auth_failed': return '#f44336'
    default: return '#9e9e9e'
  }
}

/** Compact, locale-agnostic "checked N ago" relative time. Reused by ClusterDetail. */
export function formatChecked(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d`
}

type Props = {
  cluster: K8sClusterRow
  onClick?: () => void
  /** Live enrichment, fetched once by the dashboard and passed down. */
  util?: { cpuPct: number; memPct: number } | null
  pods?: { count: number; truncated: boolean } | null
  /** Delete — shown only when provided (manage perm). */
  onDelete?: () => void
  /** Manual health re-check: button shown only when provided (wired by the dashboard). */
  onRecheck?: (id: string) => void
  /** True while a manual re-check is in flight: shows the loader instead of the chip. */
  rechecking?: boolean
  /** Download the cluster's kubeconfig: button shown only when provided (manage perm). */
  onDownloadKubeconfig?: (id: string) => void
  /** Resolved Proxmox connection name (falls back to the raw id when unresolved). */
  connectionName?: string | null
}

/** Compact stat: icon + short text; optional coloured icon for state/perf. */
function MiniStat({ icon, text, color }: { icon: string; text: string; color?: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
      <i className={icon} style={{ fontSize: 14, opacity: color ? 0.95 : 0.55, color }} />
      <Typography variant="caption" color="text.secondary">{text}</Typography>
    </Stack>
  )
}

/**
 * Compact utilisation meter: icon + percentage above a thin gradient bar. The
 * bar uses the same green→red gradient as the cluster detail per-node bars, so
 * the colour tracks the value consistently across the app.
 */
function MiniMeter({ icon, value }: { icon: string; value: number }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
      <i className={icon} style={{ fontSize: 14, opacity: 0.55 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, width: 44 }}>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {value}%
        </Typography>
        <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box
            sx={{
              width: `${value}%`,
              height: '100%',
              background: UTIL_GRADIENT_CSS,
              backgroundSize: value > 0 ? `${(100 / value) * 100}% 100%` : '100% 100%',
              backgroundPosition: 'left center',
            }}
          />
        </Box>
      </Box>
    </Stack>
  )
}

export default function ClusterCard({ cluster, onClick, util, pods, onDelete, onRecheck, rechecking, onDownloadKubeconfig, connectionName }: Props) {
  const t = useTranslations()
  const theme = useTheme()

  const ready = cluster.healthDetail?.nodesReady
  const total = cluster.healthDetail?.nodesTotal
  const checked = formatChecked(cluster.lastHealthAt)
  const distroVersion = [cluster.distro, cluster.version].filter(Boolean).join(' · ')

  const nodesColor =
    typeof total === 'number' && total > 0
      ? ((ready ?? 0) === total ? '#4caf50' : (ready ?? 0) === 0 ? '#f44336' : '#ff9800')
      : undefined
  return (
    <Card variant="outlined">
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <CardActionArea onClick={onClick} sx={{ flex: 1, minWidth: 0 }}>
        <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
            <Box sx={{ position: 'relative', width: 18, height: 18, flexShrink: 0 }}>
              <img src="/images/kubernetes-logo.svg" alt="" width={18} height={18} style={{ display: 'block' }} />
              {isIntegrating(cluster) ? (
                <CircularProgress
                  size={9}
                  thickness={6}
                  sx={{ position: 'absolute', bottom: -2, right: -2, bgcolor: 'background.paper', borderRadius: '50%' }}
                />
              ) : (
                <Box
                  sx={{
                    position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%',
                    bgcolor: healthDotColor(cluster.healthState),
                    border: '1.5px solid', borderColor: 'background.paper',
                    boxShadow: cluster.healthState === 'healthy' ? `0 0 4px ${healthDotColor(cluster.healthState)}` : 'none',
                  }}
                />
              )}
            </Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexShrink: 0 }} noWrap>
              {cluster.name}
            </Typography>
            {cluster.apiServerUrl && (
              <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 40 }}>
                {cluster.apiServerUrl}
              </Typography>
            )}
            {distroVersion && (
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                {cluster.distro && (
                  <img
                    src={distroLogo(cluster.distro)}
                    alt=""
                    width={14}
                    height={14}
                    style={{ display: 'block', borderRadius: 2, objectFit: 'contain' }}
                  />
                )}
                <Typography variant="caption" color="text.secondary" noWrap>
                  {distroVersion}
                </Typography>
              </Stack>
            )}
            {typeof total === 'number' && (
              <MiniStat icon="ri-server-line" text={`${ready ?? 0}/${total}`} color={nodesColor} />
            )}
            {pods && (
              <MiniStat icon="ri-box-3-line" text={`${pods.count}${pods.truncated ? '+' : ''}`} />
            )}
            {util && (
              <MiniMeter icon="ri-cpu-line" value={util.cpuPct} />
            )}
            {util && (
              <MiniMeter icon="ri-ram-line" value={util.memPct} />
            )}
            {cluster.proxmoxConnectionId && (
              <Chip
                size="small"
                variant="outlined"
                icon={<i className="ri-server-line" style={{ fontSize: 14, marginLeft: 6 }} />}
                label={connectionName ?? cluster.proxmoxConnectionId}
                title={cluster.proxmoxConnectionId ?? undefined}
                sx={{ borderColor: theme.palette.divider, flexShrink: 0, maxWidth: 180 }}
              />
            )}
            {rechecking || isIntegrating(cluster) ? (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  {t(`kubernetes.health.${rechecking ? 'checking' : 'integrating'}`)}
                </Typography>
              </Stack>
            ) : (
              <Chip
                size="small"
                color={healthChipColor(cluster.healthState)}
                label={t(`kubernetes.health.${cluster.healthState ?? 'unknown'}`)}
                sx={{ flexShrink: 0 }}
              />
            )}
            {checked && !rechecking && (
              <Typography
                variant="caption"
                color="text.secondary"
                title={t('kubernetes.health.lastChecked', { ago: checked })}
                sx={{ opacity: 0.8, flexShrink: 0 }}
              >
                {checked}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </CardActionArea>
      {(onRecheck || onDownloadKubeconfig || onDelete) && (
        <Stack direction="row" sx={{ flexShrink: 0, pr: 1 }}>
          {onRecheck && (
            <IconButton
              size="small"
              disabled={rechecking}
              onClick={(e) => { e.stopPropagation(); onRecheck(cluster.id) }}
              title={t('kubernetes.health.recheck')}
              aria-label={t('kubernetes.health.recheck')}
            >
              <i className="ri-refresh-line" style={{ fontSize: 18 }} />
            </IconButton>
          )}
          {onDownloadKubeconfig && (
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onDownloadKubeconfig(cluster.id) }}
              title={t('kubernetes.downloadKubeconfig')}
              aria-label={t('kubernetes.downloadKubeconfig')}
            >
              <i className="ri-download-line" style={{ fontSize: 18 }} />
            </IconButton>
          )}
          {onDelete && (
            <IconButton size="small" color="error" onClick={onDelete} title={t('common.delete')} aria-label={t('common.delete')}>
              <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Stack>
      )}
      </Box>
    </Card>
  )
}
