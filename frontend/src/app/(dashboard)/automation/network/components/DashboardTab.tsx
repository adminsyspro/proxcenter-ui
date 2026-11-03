'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Card, CardContent, Chip, CircularProgress,
  Collapse, Divider, IconButton, Paper, Skeleton,
  Stack, Tooltip, Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useVMFirewallCoverage } from '@/hooks/useZeroTrust'
import { PVE_DEFAULT_POLICY_IN, PVE_DEFAULT_POLICY_OUT } from '@/lib/firewall/pveDefaults'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'
import DashboardCoverage from './DashboardCoverage'
import { coveragePercent, dashboardPhase, recommendationKinds, type RecommendationKind } from './dashboardModel'
import DeploymentWizard from './DeploymentWizard'
import FirewallLoadAlert from './FirewallLoadAlert'
import MicrosegSummaryCard from './microseg/MicrosegSummaryCard'
import { clusterFirewallOff } from './microseg/summaryModel'

interface DashboardTabProps {
  // Data
  securityGroups: firewallAPI.SecurityGroup[]
  clusterOptions: firewallAPI.ClusterOptions | null
  clusterRules: firewallAPI.FirewallRule[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  firewallMode: firewallAPI.FirewallMode
  currentOptions: firewallAPI.ClusterOptions | firewallAPI.NodeOptions | null
  selectedConnection: string
  /** Name of the selected connection, shown on the micro-segmentation card. */
  connectionName?: string
  totalRules: number
  totalIPSetEntries: number
  nodesList: string[]
  /** What failed on the last load of the firewall data, null when it all loaded. */
  loadError?: string | null
  /** The firewall data is still loading: nothing can be said about the cluster yet. */
  loading?: boolean
  // Handlers
  reload: () => void
  // Navigation
  onNavigateTab: (tab: number) => void
  onNavigateRulesSubTab: (subTab: number) => void
}

const BreakdownRow = ({ icon, label, points, reason }: {
  icon: string; label: string; points: number; reason: string
}) => {
  const color = points > 0 ? '#22c55e' : 'text.secondary'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
      <Box sx={{ width: 24, textAlign: 'center', opacity: 0.6, fontSize: '0.85rem' }}>
        <i className={icon} />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 100 }}>{label}</Typography>
      <Box sx={{ flex: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{reason}</Typography>
      </Box>
      <Chip
        size="small"
        label={points > 0 ? `+${points}` : '0'}
        sx={{
          height: 22, minWidth: 44, fontWeight: 700, fontSize: '0.75rem',
          bgcolor: alpha(points > 0 ? '#22c55e' : '#888', 0.18),
          color,
        }}
      />
    </Box>
  )
}

type Recommendation = { kind: RecommendationKind; severity: 'error' | 'warning' | 'success'; icon: string; title: string; description: string; action: string | null; onClick: (() => void) | null }

type ScoreBand = 'good' | 'fair' | 'poor'

function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'good'
  return score >= 50 ? 'fair' : 'poor'
}

const BAND_COLOR: Record<ScoreBand, string> = { good: '#22c55e', fair: '#f59e0b', poor: '#ef4444' }
const BAND_LABEL: Record<ScoreBand, 'excellent' | 'moderate' | 'toImprove'> = { good: 'excellent', fair: 'moderate', poor: 'toImprove' }

const SEVERITY_COLOR: Record<Recommendation['severity'], string> = { error: '#ef4444', warning: '#f59e0b', success: '#22c55e' }

function RecommendationTile({ rec }: { rec: Recommendation }) {
  const color = SEVERITY_COLOR[rec.severity]

  return (
    <Box data-testid={`recommendation-${rec.kind}`} sx={{ p: 1.5, borderRadius: 1.5, flex: '1 1 280px', bgcolor: alpha(color, 0.1), border: `1px solid ${alpha(color, 0.3)}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(color, 0.22) }}>
        <i className={rec.icon} style={{ fontSize: 16, color }} />
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>{rec.title}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>{rec.description}</Typography>
      </Box>
      {rec.action && rec.onClick && (
        <Button size="small" variant="outlined" onClick={rec.onClick} sx={{ flexShrink: 0, fontSize: 11 }}>{rec.action}</Button>
      )}
    </Box>
  )
}

const GREEN = '#22c55e'
const RED = '#ef4444'
const BLUE = '#3b82f6'
const AMBER = '#f59e0b'

const chipSx = (color: string) => ({
  height: 24, fontSize: 11, fontWeight: 700,
  bgcolor: alpha(color, 0.18),
  color,
  '& .MuiChip-icon': { color: 'inherit' },
})

const policyColor = (policy: string) => (policy === 'DROP' ? RED : GREEN)

type T = ReturnType<typeof useTranslations>

function ClusterIndicators({ firewallEnabled, policyIn, policyOut, firewallMode, t }: {
  firewallEnabled: boolean; policyIn: string; policyOut: string; firewallMode: firewallAPI.FirewallMode; t: T
}) {
  const fwColor = firewallEnabled ? GREEN : RED
  const isCluster = firewallMode === 'cluster'

  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1.5, bgcolor: alpha(fwColor, 0.12) }}>
        <i className={firewallEnabled ? 'ri-shield-check-line' : 'ri-shield-cross-line'} style={{ fontSize: 16, color: fwColor }} />
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
          {t('security.firewall')} {firewallEnabled ? 'ON' : 'OFF'}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip icon={<i className="ri-arrow-down-line" style={{ fontSize: 14 }} />} label={`IN: ${policyIn}`} size="small" sx={chipSx(policyColor(policyIn))} />
        <Chip icon={<i className="ri-arrow-up-line" style={{ fontSize: 14 }} />} label={`OUT: ${policyOut}`} size="small" sx={chipSx(policyColor(policyOut))} />
        <Chip
          icon={<i className={isCluster ? 'ri-server-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
          label={isCluster ? t('firewall.cluster') : t('firewall.standalone')}
          size="small"
          sx={chipSx(isCluster ? BLUE : AMBER)}
        />
      </Stack>
    </Stack>
  )
}

function HeroUnavailable({ color, t }: { color: string; t: T }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center" data-testid="zero-trust-unavailable">
      <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
        <CircularProgress variant="determinate" value={100} size={140} thickness={3} sx={{ color: alpha(color, 0.22) }} />
        <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="h2" fontWeight={800} sx={{ color, lineHeight: 1 }} aria-hidden>-</Typography>
        </Box>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>{t('networkPage.zeroTrustScore')}</Typography>
        <Chip label={t('common.notAvailable')} sx={{ bgcolor: alpha(color, 0.2), color: 'text.secondary', fontWeight: 700, fontSize: '0.85rem', height: 28 }} />
      </Box>
    </Stack>
  )
}

/** Same footprint as the score: the gauge and the lines beside it. */
function HeroSkeleton() {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center" data-testid="firewall-loading-placeholder">
      <Skeleton variant="circular" width={140} height={140} />
      <Box sx={{ flex: 1 }}>
        <Skeleton variant="text" width="50%" height={36} />
        <Skeleton variant="text" width="30%" height={28} sx={{ mb: 1 }} />
        <Skeleton variant="text" width="80%" height={20} />
        <Skeleton variant="text" width="60%" height={20} />
      </Box>
    </Stack>
  )
}

type ScoreParts = { firewall: number; policy: number; vmCoverage: number; coveragePercent: number; total: number }

function HeroScore({ color, label, parts, protectedCount, measured, totalRules, securityGroups, firewallEnabled, hasStrictPolicy, indicators, t }: {
  color: string; label: string; parts: ScoreParts; protectedCount: number; measured: number; totalRules: number; securityGroups: number
  firewallEnabled: boolean; hasStrictPolicy: boolean; indicators: React.ReactNode; t: T
}) {
  const [showBreakdown, setShowBreakdown] = useState(false)

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center">
        {/* Gauge */}
        <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <CircularProgress variant="determinate" value={100} size={140} thickness={3} sx={{ color: alpha(color, 0.22) }} />
          <CircularProgress variant="determinate" value={parts.total} size={140} thickness={3} sx={{ color, position: 'absolute', left: 0, filter: `drop-shadow(0 0 8px ${alpha(color, 0.4)})` }} />
          <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <Typography variant="h2" fontWeight={800} sx={{ color, lineHeight: 1 }}>{parts.total}</Typography>
            <Typography variant="caption" color="text.secondary">/100</Typography>
          </Box>
        </Box>

        {/* Right side */}
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
            <Typography variant="h5" fontWeight={700}>{t('networkPage.zeroTrustScore')}</Typography>
            <Tooltip title={showBreakdown ? t('networkPage.hideDetails') : t('networkPage.showBreakdown')}>
              <IconButton size="small" onClick={() => setShowBreakdown(!showBreakdown)} sx={{ ml: 0.5 }}>
                <i className={showBreakdown ? 'ri-arrow-up-s-line' : 'ri-information-line'} style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Stack>
          <Chip label={label} sx={{ bgcolor: alpha(color, 0.2), color, fontWeight: 700, fontSize: '0.85rem', height: 28, mb: 2 }} />

          {/* KPIs row */}
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('networkPage.protectedVms')}</Typography>
              <Typography variant="h6" fontWeight={700}>{protectedCount}<Typography component="span" variant="body2" color="text.secondary"> / {measured}</Typography></Typography>
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box>
              <Typography variant="caption" color="text.secondary">{t('networkPage.totalRulesLabel')}</Typography>
              <Typography variant="h6" fontWeight={700}>{totalRules}</Typography>
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box>
              <Typography variant="caption" color="text.secondary">{t('firewall.securityGroups')}</Typography>
              <Typography variant="h6" fontWeight={700}>{securityGroups}</Typography>
            </Box>
          </Stack>

          {indicators}
        </Box>
      </Stack>

      {/* Score Breakdown */}
      <Collapse in={showBreakdown}>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          {t('networkPage.scoreBreakdown')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.5 }}>
          <BreakdownRow
            icon="ri-shield-check-line"
            label={t('networkPage.firewallComponent')}
            points={parts.firewall}
            reason={firewallEnabled ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled')}
          />
          <BreakdownRow
            icon="ri-arrow-down-line"
            label={t('networkPage.policyComponent')}
            points={parts.policy}
            reason={hasStrictPolicy ? t('networkPage.policyStrict') : t('networkPage.policyPermissive')}
          />
          <BreakdownRow
            icon="ri-computer-line"
            label={t('networkPage.vmCoverageComponent')}
            points={parts.vmCoverage}
            reason={t('networkPage.coverageReason', { percent: Math.round(parts.coveragePercent) })}
          />
        </Box>
      </Collapse>
    </>
  )
}

type Navigation = { onNavigateTab: (tab: number) => void; onNavigateRulesSubTab: (subTab: number) => void }

function recommendationOf(kind: RecommendationKind, unprotected: number, nav: Navigation, t: T): Recommendation {
  const rules = (subTab: number) => () => { nav.onNavigateTab(1); nav.onNavigateRulesSubTab(subTab) }

  switch (kind) {
    case 'stopHeld':
      return {
        kind, severity: 'warning', icon: 'ri-alarm-warning-line',
        title: t('networkPage.dashboard.stopHeldTitle'), description: t('networkPage.dashboard.stopHeldHint'),
        action: t('microsegPilot.dashboard.openShort'), onClick: () => nav.onNavigateTab(6),
      }
    case 'firewallOff':
      return {
        kind, severity: 'error', icon: 'ri-shield-cross-line',
        title: t('security.firewall') + ' ' + t('common.disabled').toLowerCase(),
        description: t('network.activateFirewall'), action: t('networkPage.viewDetails'), onClick: rules(0),
      }
    case 'policyIn':
      return {
        kind, severity: 'warning', icon: 'ri-arrow-down-line',
        title: t('firewall.policyInPermissive'),
        description: t('network.switchToDropZeroTrust'), action: t('microseg.configure'), onClick: rules(1),
      }
    case 'vms':
      return {
        kind, severity: 'warning', icon: 'ri-computer-line',
        title: t('network.vmsWithDisabledFirewall', { count: unprotected }),
        description: t('network.enableFirewallVms'), action: t('firewall.viewVms'), onClick: rules(2),
      }
    default:
      return {
        kind, severity: 'success', icon: 'ri-checkbox-circle-line',
        title: t('backups.ok'), description: t('network.infrastructureZeroTrustCompliant'), action: null, onClick: null,
      }
  }
}

export default function DashboardTab({
  firewallMode, currentOptions,
  selectedConnection, connectionName, clusterOptions, clusterRules, nodesList,
  securityGroups, totalRules, loadError, loading = false,
  reload, onNavigateTab, onNavigateRulesSubTab
}: DashboardTabProps) {
  const theme = useTheme()
  const t = useTranslations()
  const [deployWizardOpen, setDeployWizardOpen] = useState(false)

  // Read once when the tab shows (this component mounts with it), computed and cached on the server (UA44).
  const coverageRead = useVMFirewallCoverage(selectedConnection || null)
  const coverage = coverageRead.data?.computedAt ? coverageRead.data : null
  // The same two reads as the micro-segmentation card (one request each): the emergency stop may hold the firewall off.
  const microsegStatus = useMicrosegStatus(selectedConnection || null)
  const microsegPolicy = useMicrosegPolicy(selectedConnection || null)

  // Virgin cluster detection (works for both cluster and standalone, PVE always has cluster-level firewall).
  // Never on a failed load nor while loading: missing options would read as a cluster nobody configured,
  // and offer to deploy over it.
  const isVirginCluster = !loadError
    && !loading
    && clusterOptions?.enable !== 1
    && clusterRules.length === 0

  // Node options carry no policy: a host follows the cluster's, and an unset
  // policy is PVE's default, not ACCEPT (#1065).
  const policyIn = clusterOptions?.policy_in || PVE_DEFAULT_POLICY_IN
  const policyOut = clusterOptions?.policy_out || PVE_DEFAULT_POLICY_OUT
  const hasStrictPolicy = policyIn === 'DROP' || policyOut === 'DROP'
  const firewallEnabled = currentOptions?.enable === 1
  const unprotected = coverage?.disabled ?? 0

  const status = microsegStatus.data
  const policy = microsegPolicy.data
  const stopped = status?.emergency_stop ?? policy?.policy.emergency_stop ?? false
  const stopHoldsFirewall = stopped && clusterFirewallOff(status, policy)

  const phase = dashboardPhase({
    connection: !!selectedConnection,
    firewallLoading: loading,
    loadError: !!loadError,
    coverageIn: !!coverage,
    coverageFailed: !coverage && !!coverageRead.error,
    firewallOn: firewallEnabled,
    stopStateIn: (!!status || !!microsegStatus.error) && (!!policy || !!microsegPolicy.error),
  })

  // Score out of 100 in three parts; the guests whose state is unknown are left out of the coverage.
  const coverageShare = coveragePercent(coverage) ?? 0
  const parts: ScoreParts = { firewall: firewallEnabled ? 30 : 0, policy: hasStrictPolicy ? 25 : 0, vmCoverage: Math.round(coverageShare * 0.45), coveragePercent: coverageShare, total: 0 }
  parts.total = parts.firewall + parts.policy + parts.vmCoverage
  const band = scoreBand(parts.total)
  const scoreColor = phase.hero === 'ready' ? BAND_COLOR[band] : theme.palette.text.disabled
  const nav: Navigation = { onNavigateTab, onNavigateRulesSubTab }
  const openGuests = () => { onNavigateTab(1); onNavigateRulesSubTab(2) }

  let hero: React.ReactNode = <HeroSkeleton />
  if (phase.hero === 'unavailable') hero = <HeroUnavailable color={scoreColor} t={t} />
  else if (phase.hero === 'ready') {
    hero = (
      <HeroScore
        color={scoreColor}
        label={t(`networkPage.${BAND_LABEL[band]}`)}
        parts={parts}
        protectedCount={coverage?.enabled ?? 0}
        measured={coverage?.measured ?? 0}
        totalRules={totalRules}
        securityGroups={securityGroups.length}
        firewallEnabled={firewallEnabled}
        hasStrictPolicy={hasStrictPolicy}
        indicators={<ClusterIndicators firewallEnabled={firewallEnabled} policyIn={policyIn} policyOut={policyOut} firewallMode={firewallMode} t={t} />}
        t={t}
      />
    )
  }

  let advice: React.ReactNode = <Skeleton variant="rounded" height={58} sx={{ flex: '1 1 280px' }} data-testid="recommendations-loading" />
  if (phase.advice === 'unavailable') {
    advice = <Typography variant="body2" color="text.secondary" data-testid="recommendations-unavailable">{t('common.notAvailable')}</Typography>
  } else if (phase.advice === 'ready') {
    advice = recommendationKinds({ firewallOn: firewallEnabled, stopHoldsFirewall, policyIn, unprotected })
      .map(kind => <RecommendationTile key={kind} rec={recommendationOf(kind, unprotected, nav, t)} />)
  }

  return (
    <Box sx={{ p: 3 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />

      {/* Virgin cluster banner */}
      {isVirginCluster && selectedConnection && (
        <Paper sx={{
          p: 2.5, mb: 3,
          bgcolor: alpha('#f59e0b', 0.14),
          border: `1px solid ${alpha('#f59e0b', 0.4)}`,
          display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap'
        }}>
          <Avatar sx={{ width: 40, height: 40, bgcolor: alpha('#f59e0b', 0.22) }}>
            <i className="ri-shield-flash-line" style={{ fontSize: 20, color: '#f59e0b' }} />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#f59e0b' }}>
              {t('deployWizard.bannerTitle')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
              {t('deployWizard.bannerDescription')}
            </Typography>
          </Box>
          <Button
            variant="contained"
            color="warning"
            startIcon={<i className="ri-shield-flash-line" />}
            onClick={() => setDeployWizardOpen(true)}
            sx={{ flexShrink: 0 }}
          >
            {t('deployWizard.bannerButton')}
          </Button>
        </Paper>
      )}

      <DeploymentWizard
        open={deployWizardOpen}
        onClose={() => setDeployWizardOpen(false)}
        selectedConnection={selectedConnection}
        clusterOptions={clusterOptions}
        clusterRules={clusterRules}
        nodesList={nodesList}
        firewallMode={firewallMode}
        onComplete={reload}
      />

      {/* Section 1: Security Posture (hero) */}
      <Card sx={{
        background: `linear-gradient(135deg, ${alpha(scoreColor, 0.14)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 50%, ${alpha(scoreColor, 0.08)} 100%)`,
        border: '1px solid',
        borderColor: alpha(scoreColor, 0.3),
        position: 'relative',
        overflow: 'hidden',
        mb: 3,
        '&:hover': { borderColor: alpha(scoreColor, 0.5), boxShadow: `0 8px 32px ${alpha(scoreColor, 0.2)}` },
      }}>
        <Box sx={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(scoreColor, 0.15)} 0%, transparent 70%)` }} />
        <CardContent sx={{ p: 3, position: 'relative' }}>
          {hero}
        </CardContent>
      </Card>

      {/* Micro-segmentation at a glance: one click opens its tab (6) */}
      {selectedConnection && (
        <MicrosegSummaryCard key={selectedConnection} connectionId={selectedConnection} connectionName={connectionName} onOpen={() => onNavigateTab(6)} />
      )}

      {/* Section 2: VM Coverage, computed on the server */}
      {selectedConnection && (
        <DashboardCoverage
          coverage={coverage}
          error={coverageRead.error}
          refreshing={coverageRead.refreshing}
          onRefresh={() => { void coverageRead.refresh() }}
          onDetails={openGuests}
        />
      )}

      {/* Section 3: Recommendations (action-oriented) */}
      <Paper sx={{ p: 2.5, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
          {t('network.zeroTrustRecommendations')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {advice}
        </Box>
      </Paper>
    </Box>
  )
}
