'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Card, CardContent, Chip, CircularProgress,
  Collapse, Divider, IconButton, LinearProgress, Paper, Skeleton,
  Stack, Tooltip, Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import DeploymentWizard from './DeploymentWizard'

interface DashboardTabProps {
  // Data
  securityGroups: firewallAPI.SecurityGroup[]
  clusterOptions: firewallAPI.ClusterOptions | null
  clusterRules: firewallAPI.FirewallRule[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  firewallMode: firewallAPI.FirewallMode
  currentOptions: firewallAPI.ClusterOptions | firewallAPI.NodeOptions | null
  selectedConnection: string
  totalRules: number
  totalIPSetEntries: number
  nodesList: string[]
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
          bgcolor: alpha(points > 0 ? '#22c55e' : '#888', 0.12),
          color,
        }}
      />
    </Box>
  )
}

export default function DashboardTab({
  vmFirewallData, loadingVMRules, firewallMode, currentOptions,
  selectedConnection, clusterOptions, clusterRules, nodesList,
  securityGroups, totalRules,
  reload, onNavigateTab, onNavigateRulesSubTab
}: DashboardTabProps) {
  const theme = useTheme()
  const t = useTranslations()
  const [deployWizardOpen, setDeployWizardOpen] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)

  // Virgin cluster detection (works for both cluster and standalone — PVE always has cluster-level firewall)
  const isVirginCluster = clusterOptions?.enable !== 1
    && clusterRules.length === 0

  // Compute shared metrics
  const vmsWithFirewall = vmFirewallData.filter(v => v.firewallEnabled).length
  const totalVMs = vmFirewallData.length || 1
  const vmCoverage = (vmsWithFirewall / totalVMs) * 100
  const hasStrictPolicy = currentOptions?.policy_in === 'DROP' || currentOptions?.policy_out === 'DROP'
  const firewallEnabled = currentOptions?.enable === 1
  const unprotected = vmFirewallData.filter(v => !v.firewallEnabled).length

  // Individual score components for breakdown (now out of 100 with 3 components)
  const scoreFirewall = firewallEnabled ? 30 : 0
  const scorePolicy = hasStrictPolicy ? 25 : 0
  const scoreVmCoverage = Math.round(vmCoverage * 0.45)
  const score = scoreFirewall + scorePolicy + scoreVmCoverage

  const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
  const scoreLabel = score >= 80 ? t('networkPage.excellent') : score >= 50 ? t('networkPage.moderate') : t('networkPage.toImprove')

  return (
    <Box sx={{ p: 3 }}>
      {/* Virgin cluster banner */}
      {isVirginCluster && selectedConnection && (
        <Paper sx={{
          p: 2.5, mb: 3,
          bgcolor: alpha('#f59e0b', 0.08),
          border: `1px solid ${alpha('#f59e0b', 0.3)}`,
          display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap'
        }}>
          <Avatar sx={{ width: 40, height: 40, bgcolor: alpha('#f59e0b', 0.15) }}>
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
        background: `linear-gradient(135deg, ${alpha(scoreColor, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(scoreColor, 0.03)} 100%)`,
        border: '1px solid',
        borderColor: alpha(scoreColor, 0.3),
        position: 'relative',
        overflow: 'hidden',
        mb: 3,
        '&:hover': { borderColor: alpha(scoreColor, 0.5), boxShadow: `0 8px 32px ${alpha(scoreColor, 0.15)}` },
      }}>
        <Box sx={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(scoreColor, 0.1)} 0%, transparent 70%)` }} />
        <CardContent sx={{ p: 3, position: 'relative' }}>
          {loadingVMRules ? (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center">
              <Skeleton variant="circular" width={140} height={140} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="50%" height={36} />
                <Skeleton variant="text" width="30%" height={28} sx={{ mb: 1 }} />
                <Skeleton variant="text" width="80%" height={20} />
                <Skeleton variant="text" width="60%" height={20} />
              </Box>
            </Stack>
          ) : (
            <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center">
                {/* Gauge */}
                <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <CircularProgress variant="determinate" value={100} size={140} thickness={3} sx={{ color: alpha(scoreColor, 0.15) }} />
                  <CircularProgress variant="determinate" value={score} size={140} thickness={3} sx={{ color: scoreColor, position: 'absolute', left: 0, filter: `drop-shadow(0 0 8px ${alpha(scoreColor, 0.4)})` }} />
                  <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    <Typography variant="h2" fontWeight={800} sx={{ color: scoreColor, lineHeight: 1 }}>{score}</Typography>
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
                  <Chip label={scoreLabel} sx={{ bgcolor: alpha(scoreColor, 0.15), color: scoreColor, fontWeight: 700, fontSize: '0.85rem', height: 28, mb: 2 }} />

                  {/* KPIs row */}
                  <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('networkPage.protectedVms')}</Typography>
                      <Typography variant="h6" fontWeight={700}>{vmsWithFirewall}<Typography component="span" variant="body2" color="text.secondary"> / {vmFirewallData.length}</Typography></Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem />
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('networkPage.totalRulesLabel')}</Typography>
                      <Typography variant="h6" fontWeight={700}>{totalRules}</Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem />
                    <Box>
                      <Typography variant="caption" color="text.secondary">{t('firewall.securityGroups')}</Typography>
                      <Typography variant="h6" fontWeight={700}>{securityGroups.length}</Typography>
                    </Box>
                  </Stack>

                  {/* Cluster indicators */}
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1.5, bgcolor: alpha(firewallEnabled ? '#22c55e' : '#ef4444', 0.05) }}>
                      <i className={firewallEnabled ? "ri-shield-check-line" : "ri-shield-cross-line"} style={{ fontSize: 16, color: firewallEnabled ? '#22c55e' : '#ef4444' }} />
                      <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                        {t('security.firewall')} {firewallEnabled ? 'ON' : 'OFF'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip
                        icon={<i className="ri-arrow-down-line" style={{ fontSize: 14 }} />}
                        label={`IN: ${currentOptions?.policy_in || 'ACCEPT'}`}
                        size="small"
                        sx={{
                          height: 24, fontSize: 11, fontWeight: 700,
                          bgcolor: alpha(currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e', 0.12),
                          color: currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e',
                          '& .MuiChip-icon': { color: 'inherit' }
                        }}
                      />
                      <Chip
                        icon={<i className="ri-arrow-up-line" style={{ fontSize: 14 }} />}
                        label={`OUT: ${currentOptions?.policy_out || 'ACCEPT'}`}
                        size="small"
                        sx={{
                          height: 24, fontSize: 11, fontWeight: 700,
                          bgcolor: alpha(currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e', 0.12),
                          color: currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e',
                          '& .MuiChip-icon': { color: 'inherit' }
                        }}
                      />
                      <Chip
                        icon={<i className={firewallMode === 'cluster' ? "ri-server-line" : "ri-computer-line"} style={{ fontSize: 14 }} />}
                        label={firewallMode === 'cluster' ? t('firewall.cluster') : t('firewall.standalone')}
                        size="small"
                        sx={{
                          height: 24, fontSize: 11, fontWeight: 700,
                          bgcolor: alpha(firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b', 0.12),
                          color: firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b',
                          '& .MuiChip-icon': { color: 'inherit' }
                        }}
                      />
                    </Stack>
                  </Stack>
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
                    points={scoreFirewall}
                    reason={firewallEnabled ? t('networkPage.firewallEnabled') : t('networkPage.firewallDisabled')}
                  />
                  <BreakdownRow
                    icon="ri-arrow-down-line"
                    label={t('networkPage.policyComponent')}
                    points={scorePolicy}
                    reason={hasStrictPolicy ? t('networkPage.policyStrict') : t('networkPage.policyPermissive')}
                  />
                  <BreakdownRow
                    icon="ri-computer-line"
                    label={t('networkPage.vmCoverageComponent')}
                    points={scoreVmCoverage}
                    reason={t('networkPage.coverageReason', { percent: Math.round(vmCoverage) })}
                  />
                </Box>
              </Collapse>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 2: VM Coverage (simplified) */}
      <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              {t('networkPage.vmFirewallCoverage')}
            </Typography>
            {loadingVMRules && <Chip label={t('networkPage.loading')} size="small" sx={{ height: 20, fontSize: 10 }} />}
          </Box>
          <Button size="small" onClick={() => { onNavigateTab(1); onNavigateRulesSubTab(2) }} endIcon={<i className="ri-arrow-right-line" />}>
            {t('networkPage.viewDetails')}
          </Button>
        </Box>

        {loadingVMRules ? (
          <Box sx={{ py: 3 }}><LinearProgress /></Box>
        ) : (
          <Stack spacing={2}>
            {/* Inline compact stats */}
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
              <Chip
                icon={<i className="ri-shield-check-line" style={{ fontSize: 14, color: '#22c55e' }} />}
                label={`${t('networkPage.protectedCount')}: ${vmsWithFirewall}/${vmFirewallData.length}`}
                size="small"
                sx={{ height: 28, fontWeight: 600, bgcolor: alpha('#22c55e', 0.08), '& .MuiChip-label': { fontSize: 12 } }}
              />
              {unprotected > 0 && (
                <Chip
                  icon={<i className="ri-error-warning-line" style={{ fontSize: 14, color: '#ef4444' }} />}
                  label={`${t('networkPage.unprotectedCount')}: ${unprotected}`}
                  size="small"
                  sx={{ height: 28, fontWeight: 600, bgcolor: alpha('#ef4444', 0.08), color: '#ef4444', '& .MuiChip-label': { fontSize: 12 } }}
                />
              )}
            </Stack>

            {/* Progress bars */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.protectionRate')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round((vmsWithFirewall / totalVMs) * 100)}%</Typography>
              </Box>
              <LinearProgress variant="determinate" value={(vmsWithFirewall / totalVMs) * 100} sx={{ height: 10, borderRadius: 5, bgcolor: alpha('#ef4444', 0.15), '& .MuiLinearProgress-bar': { bgcolor: '#22c55e', borderRadius: 5 } }} />
            </Box>
          </Stack>
        )}
      </Paper>

      {/* Section 3: Recommendations (action-oriented) */}
      <Paper sx={{ p: 2.5, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
          {t('network.zeroTrustRecommendations')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {(() => {
            const recommendations: Array<{ severity: string; icon: string; title: string; description: string; action: string | null; onClick: (() => void) | null }> = []

            if (currentOptions?.enable !== 1) {
              recommendations.push({
                severity: 'error', icon: 'ri-shield-cross-line',
                title: t('security.firewall') + ' ' + t('common.disabled').toLowerCase(),
                description: t('network.activateFirewall'), action: t('networkPage.viewDetails'), onClick: () => { onNavigateTab(1); onNavigateRulesSubTab(0) }
              })
            }
            if (currentOptions?.policy_in !== 'DROP') {
              recommendations.push({
                severity: 'warning', icon: 'ri-arrow-down-line',
                title: t('firewall.policyInPermissive'),
                description: t('network.switchToDropZeroTrust'), action: t('microseg.configure'), onClick: () => { onNavigateTab(1); onNavigateRulesSubTab(1) }
              })
            }
            const unprotectedVMs = vmFirewallData.filter(v => !v.firewallEnabled)
            if (unprotectedVMs.length > 0) {
              recommendations.push({
                severity: 'warning', icon: 'ri-computer-line',
                title: t('network.vmsWithDisabledFirewall', { count: unprotectedVMs.length }),
                description: t('network.enableFirewallVms'), action: t('firewall.viewVms'), onClick: () => { onNavigateTab(1); onNavigateRulesSubTab(2) }
              })
            }
            if (recommendations.length === 0) {
              recommendations.push({
                severity: 'success', icon: 'ri-checkbox-circle-line',
                title: t('backups.ok'), description: t('network.infrastructureZeroTrustCompliant'), action: null, onClick: null
              })
            }

            return recommendations.map((rec, idx) => {
              const severityColor = rec.severity === 'error' ? '#ef4444' : rec.severity === 'warning' ? '#f59e0b' : rec.severity === 'success' ? '#22c55e' : '#3b82f6'
              return (
                <Box key={idx} sx={{ p: 1.5, borderRadius: 1.5, flex: '1 1 280px', bgcolor: alpha(severityColor, 0.05), border: `1px solid ${alpha(severityColor, 0.2)}`, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(severityColor, 0.15) }}>
                    <i className={rec.icon} style={{ fontSize: 16, color: severityColor }} />
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>{rec.title}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>{rec.description}</Typography>
                  </Box>
                  {rec.action && (
                    <Button size="small" variant="outlined" onClick={rec.onClick!} sx={{ flexShrink: 0, fontSize: 11 }}>{rec.action}</Button>
                  )}
                </Box>
              )
            })
          })()}
        </Box>
      </Paper>
    </Box>
  )
}
