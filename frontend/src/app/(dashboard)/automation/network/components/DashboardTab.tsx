'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Chip, LinearProgress, Paper, Stack,
  Switch, Typography, useTheme, alpha
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
  handleToggleClusterFirewall: () => void
  reload: () => void
  // Navigation
  onNavigateTab: (tab: number) => void
  onNavigateRulesSubTab: (subTab: number) => void
}

export default function DashboardTab({
  vmFirewallData, loadingVMRules, firewallMode, currentOptions,
  selectedConnection, clusterOptions, clusterRules, nodesList,
  handleToggleClusterFirewall, reload, onNavigateTab, onNavigateRulesSubTab
}: DashboardTabProps) {
  const theme = useTheme()
  const t = useTranslations()
  const [deployWizardOpen, setDeployWizardOpen] = useState(false)

  // Virgin cluster detection (works for both cluster and standalone — PVE always has cluster-level firewall)
  const isVirginCluster = clusterOptions?.enable !== 1
    && clusterRules.length === 0

  // Compute shared metrics
  const vmsWithFirewall = vmFirewallData.filter(v => v.firewallEnabled).length
  const totalVMs = vmFirewallData.length || 1
  const vmCoverage = (vmsWithFirewall / totalVMs) * 100
  const vmsWithSG = vmFirewallData.filter(v => v.rules.some(r => r.type === 'group')).length
  const sgCoverage = totalVMs > 0 ? (vmsWithSG / totalVMs) * 100 : 0
  const hasStrictPolicy = currentOptions?.policy_in === 'DROP' || currentOptions?.policy_out === 'DROP'
  const firewallEnabled = currentOptions?.enable === 1
  const unprotected = vmFirewallData.filter(v => !v.firewallEnabled).length

  let score = 0
  if (firewallEnabled) score += 20
  if (hasStrictPolicy) score += 15
  score += Math.round(vmCoverage * 0.35)
  score += Math.round(sgCoverage * 0.30)

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
      <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 2 }}>
          {t('networkPage.securityPosture')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Score gauge — larger */}
          <Box sx={{ textAlign: 'center' }}>
            <Box sx={{
              width: 110, height: 110, borderRadius: '50%',
              background: `conic-gradient(${scoreColor} ${score * 3.6}deg, ${alpha(theme.palette.divider, 0.2)} 0deg)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Box sx={{
                width: 88, height: 88, borderRadius: '50%', bgcolor: 'background.paper',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
              }}>
                <Typography variant="h3" sx={{ fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{score}</Typography>
                <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', mt: 0.25 }}>/ 100</Typography>
              </Box>
            </Box>
            <Chip label={scoreLabel} size="small" sx={{ bgcolor: alpha(scoreColor, 0.15), color: scoreColor, fontWeight: 700, mt: 1, height: 20, fontSize: 10 }} />
          </Box>

          {/* 2x2 indicators grid */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, minWidth: 280 }}>
            {/* Firewall ON/OFF */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 1.5, bgcolor: alpha(firewallEnabled ? '#22c55e' : '#ef4444', 0.05) }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(firewallEnabled ? '#22c55e' : '#ef4444', 0.15) }}>
                <i className={firewallEnabled ? "ri-shield-check-line" : "ri-shield-cross-line"} style={{ fontSize: 16, color: firewallEnabled ? '#22c55e' : '#ef4444' }} />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }}>{t('security.firewall')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: firewallEnabled ? '#22c55e' : '#ef4444', fontSize: 12 }}>
                  {firewallEnabled ? 'ON' : 'OFF'}
                </Typography>
              </Box>
              <Switch checked={firewallEnabled} onChange={handleToggleClusterFirewall} color="success" disabled={!selectedConnection} size="small" />
            </Box>

            {/* Policy IN */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.divider, 0.04) }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e', 0.15) }}>
                <i className="ri-arrow-down-line" style={{ fontSize: 16, color: currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e' }} />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }}>{t('firewall.policyIn')}</Typography>
                <Chip
                  label={currentOptions?.policy_in || 'ACCEPT'}
                  size="small"
                  sx={{
                    height: 20, fontSize: 10, fontWeight: 700,
                    bgcolor: alpha(currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e', 0.15),
                    color: currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e'
                  }}
                />
              </Box>
            </Box>

            {/* Policy OUT */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.divider, 0.04) }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e', 0.15) }}>
                <i className="ri-arrow-up-line" style={{ fontSize: 16, color: currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e' }} />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }}>{t('firewall.policyOut')}</Typography>
                <Chip
                  label={currentOptions?.policy_out || 'ACCEPT'}
                  size="small"
                  sx={{
                    height: 20, fontSize: 10, fontWeight: 700,
                    bgcolor: alpha(currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e', 0.15),
                    color: currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e'
                  }}
                />
              </Box>
            </Box>

            {/* Mode */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.divider, 0.04) }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b', 0.15) }}>
                <i className={firewallMode === 'cluster' ? "ri-server-line" : "ri-computer-line"} style={{ fontSize: 16, color: firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b' }} />
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, display: 'block' }}>{t('firewall.mode')}</Typography>
                <Chip
                  label={firewallMode === 'cluster' ? t('firewall.cluster') : t('firewall.standalone')}
                  size="small"
                  sx={{
                    height: 20, fontSize: 10, fontWeight: 700,
                    bgcolor: alpha(firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b', 0.15),
                    color: firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b'
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* Section 2: VM Coverage (simplified) */}
      <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              {t('networkPage.vmFirewallCoverage')}
            </Typography>
            {loadingVMRules && <Chip label={t('networkPage.loading')} size="small" sx={{ height: 20, fontSize: 10 }} />}
          </Box>
          <Button size="small" onClick={() => { onNavigateTab(2); onNavigateRulesSubTab(2) }} endIcon={<i className="ri-arrow-right-line" />}>
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
              <Chip
                icon={<i className="ri-shield-keyhole-line" style={{ fontSize: 14, color: '#8b5cf6' }} />}
                label={`${t('networkPage.withSgCount')}: ${vmsWithSG}/${vmFirewallData.length}`}
                size="small"
                sx={{ height: 28, fontWeight: 600, bgcolor: alpha('#8b5cf6', 0.08), '& .MuiChip-label': { fontSize: 12 } }}
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
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.microSegmentation')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round((vmsWithSG / totalVMs) * 100)}%</Typography>
              </Box>
              <LinearProgress variant="determinate" value={(vmsWithSG / totalVMs) * 100} sx={{ height: 10, borderRadius: 5, bgcolor: alpha(theme.palette.divider, 0.2), '& .MuiLinearProgress-bar': { bgcolor: '#8b5cf6', borderRadius: 5 } }} />
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
                description: t('network.activateFirewall'), action: t('common.enabled'), onClick: handleToggleClusterFirewall
              })
            }
            if (currentOptions?.policy_in !== 'DROP') {
              recommendations.push({
                severity: 'warning', icon: 'ri-arrow-down-line',
                title: t('firewall.policyInPermissive'),
                description: t('network.switchToDropZeroTrust'), action: t('microseg.configure'), onClick: () => { onNavigateTab(2); onNavigateRulesSubTab(1) }
              })
            }
            const unprotectedVMs = vmFirewallData.filter(v => !v.firewallEnabled)
            if (unprotectedVMs.length > 0) {
              recommendations.push({
                severity: 'warning', icon: 'ri-computer-line',
                title: t('network.vmsWithDisabledFirewall', { count: unprotectedVMs.length }),
                description: t('network.enableFirewallVms'), action: t('firewall.viewVms'), onClick: () => { onNavigateTab(2); onNavigateRulesSubTab(2) }
              })
            }
            const vmsWithoutSG = vmFirewallData.filter(v => v.firewallEnabled && !v.rules.some(r => r.type === 'group'))
            if (vmsWithoutSG.length > 0 && firewallMode === 'cluster') {
              recommendations.push({
                severity: 'info', icon: 'ri-shield-keyhole-line',
                title: t('firewall.vmsWithoutMicroseg', { count: vmsWithoutSG.length }),
                description: t('microseg.clickVmToIsolate'), action: t('microseg.configure'), onClick: () => onNavigateTab(1)
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
