'use client'

import { useTranslations } from 'next-intl'

import {
  Avatar, Box, Button, Chip, Divider, Grid, LinearProgress, Paper, Stack,
  Switch, Tooltip, Typography, useTheme, alpha,
  FormControl, InputLabel, Select, MenuItem
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import { getGroupColor } from '../types'

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
  // Handlers
  handleToggleClusterFirewall: () => void
  // Navigation
  onNavigateTab: (tab: number) => void
  onNavigateRulesSubTab: (subTab: number) => void
}

export default function DashboardTab({
  securityGroups, clusterOptions, clusterRules, aliases, ipsets,
  vmFirewallData, loadingVMRules, firewallMode, currentOptions,
  selectedConnection, totalRules, totalIPSetEntries,
  handleToggleClusterFirewall, onNavigateTab, onNavigateRulesSubTab
}: DashboardTabProps) {
  const theme = useTheme()
  const t = useTranslations()

  return (
    <Box sx={{ p: 3 }}>
      {/* Row 1: Score + Firewall Status + Resources */}
      <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Security Score */}
          <Box sx={{ minWidth: 200 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                {t('networkPage.zeroTrustScore')}
              </Typography>
              <Tooltip title={t('networkPage.basedOnCoverage')}>
                <i className="ri-information-line" style={{ fontSize: 14, color: theme.palette.text.disabled }} />
              </Tooltip>
            </Box>
            {(() => {
              const vmsWithFirewall = vmFirewallData.filter(v => v.firewallEnabled).length
              const totalVMs = vmFirewallData.length || 1
              const vmCoverage = (vmsWithFirewall / totalVMs) * 100
              const vmsWithSG = vmFirewallData.filter(v => v.rules.some(r => r.type === 'group')).length
              const sgCoverage = totalVMs > 0 ? (vmsWithSG / totalVMs) * 100 : 0
              const hasStrictPolicy = currentOptions?.policy_in === 'DROP' || currentOptions?.policy_out === 'DROP'
              const firewallEnabled = currentOptions?.enable === 1

              let score = 0
              if (firewallEnabled) score += 20
              if (hasStrictPolicy) score += 15
              score += Math.round(vmCoverage * 0.35)
              score += Math.round(sgCoverage * 0.30)

              const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444'
              const scoreLabel = score >= 80 ? t('networkPage.excellent') : score >= 50 ? t('networkPage.moderate') : t('networkPage.toImprove')

              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Box sx={{ position: 'relative', textAlign: 'center' }}>
                    <Box sx={{
                      width: 90, height: 90, borderRadius: '50%',
                      background: `conic-gradient(${scoreColor} ${score * 3.6}deg, ${alpha(theme.palette.divider, 0.2)} 0deg)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Box sx={{
                        width: 72, height: 72, borderRadius: '50%', bgcolor: 'background.paper',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Typography variant="h3" sx={{ fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{score}</Typography>
                      </Box>
                    </Box>
                    <Chip label={scoreLabel} size="small" sx={{ bgcolor: alpha(scoreColor, 0.15), color: scoreColor, fontWeight: 700, mt: 1, height: 20, fontSize: 10 }} />
                  </Box>
                  <Stack spacing={0.5}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className={firewallEnabled ? "ri-checkbox-circle-fill" : "ri-close-circle-fill"} style={{ fontSize: 14, color: firewallEnabled ? '#22c55e' : '#ef4444' }} />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.firewallActive')}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className={hasStrictPolicy ? "ri-checkbox-circle-fill" : "ri-close-circle-fill"} style={{ fontSize: 14, color: hasStrictPolicy ? '#22c55e' : '#ef4444' }} />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.strictPolicy')}</Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.protectedPercent', { percent: Math.round(vmCoverage) })}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.microSegPercent', { percent: Math.round(sgCoverage) })}</Typography>
                  </Stack>
                </Box>
              )
            })()}
          </Box>

          <Divider orientation="vertical" flexItem />

          {/* Firewall Status */}
          <Box sx={{ minWidth: 280 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
              {t('networkPage.firewallState')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Avatar sx={{ width: 40, height: 40, bgcolor: currentOptions?.enable === 1 ? alpha('#22c55e', 0.15) : alpha('#ef4444', 0.15) }}>
                <i className={currentOptions?.enable === 1 ? "ri-shield-check-line" : "ri-shield-cross-line"} style={{ fontSize: 20, color: currentOptions?.enable === 1 ? '#22c55e' : '#ef4444' }} />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {firewallMode === 'cluster' ? t('networkPage.firewallCluster') : t('networkPage.firewallHost')}
                  </Typography>
                  <Chip label={firewallMode === 'cluster' ? 'Cluster' : 'Standalone'} size="small" sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: firewallMode === 'cluster' ? alpha('#3b82f6', 0.15) : alpha('#f59e0b', 0.15), color: firewallMode === 'cluster' ? '#3b82f6' : '#f59e0b' }} />
                </Box>
                <Typography variant="caption" sx={{ color: currentOptions?.enable === 1 ? '#22c55e' : '#ef4444' }}>
                  {currentOptions?.enable === 1 ? `● ${t('networkPage.active')}` : `○ ${t('networkPage.inactive')}`}
                </Typography>
              </Box>
              <Switch checked={currentOptions?.enable === 1} onChange={handleToggleClusterFirewall} color="success" disabled={!selectedConnection} size="small" />
            </Box>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <Chip icon={<i className="ri-arrow-down-line" style={{ fontSize: 10 }} />} label={`IN: ${currentOptions?.policy_in || 'ACCEPT'}`} size="small" sx={{ height: 24, fontSize: 10, fontWeight: 600, bgcolor: currentOptions?.policy_in === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15), color: currentOptions?.policy_in === 'DROP' ? '#ef4444' : '#22c55e' }} />
              <Chip icon={<i className="ri-arrow-up-line" style={{ fontSize: 10 }} />} label={`OUT: ${currentOptions?.policy_out || 'ACCEPT'}`} size="small" sx={{ height: 24, fontSize: 10, fontWeight: 600, bgcolor: currentOptions?.policy_out === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15), color: currentOptions?.policy_out === 'DROP' ? '#ef4444' : '#22c55e' }} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<i className="ri-shield-keyhole-line" style={{ fontSize: 14 }} />} onClick={() => onNavigateTab(1)} sx={{ fontSize: 11 }}>Micro-segmentation</Button>
              <Button size="small" variant="outlined" startIcon={<i className="ri-computer-line" style={{ fontSize: 14 }} />} onClick={() => { onNavigateTab(2); onNavigateRulesSubTab(2) }} sx={{ fontSize: 11 }}>VM Rules</Button>
            </Stack>
          </Box>

          <Divider orientation="vertical" flexItem />

          {/* Quick Resources */}
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>
              {t('networkPage.resources')}
            </Typography>
            <Stack direction="row" spacing={2}>
              <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#22c55e', 0.05), borderRadius: 1, flex: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{securityGroups.length}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>SG</Typography>
              </Box>
              <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#3b82f6', 0.05), borderRadius: 1, flex: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 900, color: '#3b82f6', lineHeight: 1 }}>{totalRules}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>{t('networkPage.rules')}</Typography>
              </Box>
              <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#8b5cf6', 0.05), borderRadius: 1, flex: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 900, color: '#8b5cf6', lineHeight: 1 }}>{aliases.length}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>Aliases</Typography>
              </Box>
              <Box sx={{ textAlign: 'center', p: 1.5, bgcolor: alpha('#f59e0b', 0.05), borderRadius: 1, flex: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 900, color: '#f59e0b', lineHeight: 1 }}>{ipsets.length}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>IP Sets</Typography>
              </Box>
            </Stack>
          </Box>
        </Box>
      </Paper>

      {/* Row 2: VM Coverage */}
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
        ) : (() => {
          const protected_ = vmFirewallData.filter(v => v.firewallEnabled).length
          const unprotected = vmFirewallData.filter(v => !v.firewallEnabled).length
          const withRules = vmFirewallData.filter(v => v.rules.length > 0).length
          const withSG = vmFirewallData.filter(v => v.rules.some(r => r.type === 'group')).length
          const total = vmFirewallData.length || 1

          return (
            <Box sx={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
              <Stack direction="row" spacing={2}>
                <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#22c55e', 0.05), borderRadius: 2, minWidth: 100 }}>
                  <Typography variant="h2" sx={{ fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{protected_}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.protectedLabel')}</Typography>
                </Box>
                <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#ef4444', 0.05), borderRadius: 2, minWidth: 100 }}>
                  <Typography variant="h2" sx={{ fontWeight: 900, color: '#ef4444', lineHeight: 1 }}>{unprotected}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.unprotectedLabel')}</Typography>
                </Box>
                <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#3b82f6', 0.05), borderRadius: 2, minWidth: 100 }}>
                  <Typography variant="h2" sx={{ fontWeight: 900, color: '#3b82f6', lineHeight: 1 }}>{withRules}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.withRulesLabel')}</Typography>
                </Box>
                <Box sx={{ textAlign: 'center', p: 2.5, bgcolor: alpha('#8b5cf6', 0.05), borderRadius: 2, minWidth: 100 }}>
                  <Typography variant="h2" sx={{ fontWeight: 900, color: '#8b5cf6', lineHeight: 1 }}>{withSG}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.withSgLabel')}</Typography>
                </Box>
              </Stack>

              <Box sx={{ flex: 1, minWidth: 300 }}>
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.protectionRate')}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round((protected_ / total) * 100)}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={(protected_ / total) * 100} sx={{ height: 10, borderRadius: 5, bgcolor: alpha('#ef4444', 0.15), '& .MuiLinearProgress-bar': { bgcolor: '#22c55e', borderRadius: 5 } }} />
                </Box>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.microSegmentation')}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{Math.round((withSG / total) * 100)}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={(withSG / total) * 100} sx={{ height: 10, borderRadius: 5, bgcolor: alpha(theme.palette.divider, 0.2), '& .MuiLinearProgress-bar': { bgcolor: '#8b5cf6', borderRadius: 5 } }} />
                </Box>
              </Box>
            </Box>
          )
        })()}
      </Paper>

      {/* Row 3: Security Groups */}
      <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>Security Groups</Typography>
          <Button size="small" onClick={() => { onNavigateTab(2); onNavigateRulesSubTab(3) }} endIcon={<i className="ri-arrow-right-line" />}>
            {t('networkPage.manage')}
          </Button>
        </Box>

        {firewallMode === 'cluster' ? (
          securityGroups.length > 0 ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {securityGroups.map((group, index) => {
                const color = getGroupColor(index)
                const isIsolation = group.group.startsWith('sg-base-')
                return (
                  <Chip
                    key={group.group}
                    icon={isIsolation ? <i className="ri-lock-line" style={{ fontSize: 12 }} /> : undefined}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <code style={{ background: 'transparent', fontSize: 11, color: 'inherit' }}>{group.group}</code>
                        <Box component="span" sx={{ bgcolor: alpha(color, 0.3), color: color, px: 0.5, borderRadius: 0.5, fontSize: 10, fontWeight: 700, ml: 0.5 }}>
                          {group.rules?.length || 0}
                        </Box>
                      </Box>
                    }
                    size="small"
                    onClick={() => { onNavigateTab(2); onNavigateRulesSubTab(3) }}
                    sx={{ cursor: 'pointer', borderLeft: `3px solid ${color}`, borderRadius: 1, height: 28, bgcolor: isIsolation ? alpha('#8b5cf6', 0.05) : 'transparent', '&:hover': { bgcolor: alpha(color, 0.1) } }}
                  />
                )
              })}
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.noSecurityGroup')}</Typography>
            </Box>
          )
        ) : (
          <Box sx={{ p: 2, bgcolor: alpha('#f59e0b', 0.05), borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-information-line" style={{ fontSize: 16, color: '#f59e0b' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.sgNotAvailableStandalone')}</Typography>
            </Box>
          </Box>
        )}
      </Paper>

      {/* Row 4: Recommendations */}
      <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mb: 2 }}>
          {t('network.zeroTrustRecommendations')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
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
                title: 'Policy IN permissive',
                description: t('network.switchToDropZeroTrust'), action: t('microseg.configure'), onClick: () => { onNavigateTab(2); onNavigateRulesSubTab(1) }
              })
            }
            const unprotectedVMs = vmFirewallData.filter(v => !v.firewallEnabled)
            if (unprotectedVMs.length > 0) {
              recommendations.push({
                severity: 'warning', icon: 'ri-computer-line',
                title: t('network.vmsWithDisabledFirewall', { count: unprotectedVMs.length }),
                description: t('network.enableFirewallVms'), action: t('common.view') + ' VMs', onClick: () => { onNavigateTab(2); onNavigateRulesSubTab(2) }
              })
            }
            const vmsWithoutSG = vmFirewallData.filter(v => v.firewallEnabled && !v.rules.some(r => r.type === 'group'))
            if (vmsWithoutSG.length > 0 && firewallMode === 'cluster') {
              recommendations.push({
                severity: 'info', icon: 'ri-shield-keyhole-line',
                title: `${vmsWithoutSG.length} VMs without micro-segmentation`,
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
                <Box key={idx} sx={{ p: 2, borderRadius: 1.5, flex: '1 1 300px', bgcolor: alpha(severityColor, 0.05), border: `1px solid ${alpha(severityColor, 0.2)}`, display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ width: 36, height: 36, bgcolor: alpha(severityColor, 0.15) }}>
                    <i className={rec.icon} style={{ fontSize: 18, color: severityColor }} />
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{rec.title}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{rec.description}</Typography>
                  </Box>
                  {rec.action && (
                    <Button size="small" variant="outlined" onClick={rec.onClick!} sx={{ flexShrink: 0 }}>{rec.action}</Button>
                  )}
                </Box>
              )
            })
          })()}
        </Box>
      </Paper>

      {/* Row 5: Firewall Configuration + Statistics (merged from Settings tab) */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('networkPage.firewallConfiguration')}</Typography>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('security.firewall')}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('networkPage.enablesClusterRules')}</Typography>
                </Box>
                <Switch checked={clusterOptions?.enable === 1} onChange={handleToggleClusterFirewall} color="success" disabled={!selectedConnection} />
              </Box>
              <Divider />
              <FormControl fullWidth size="small">
                <InputLabel>Policy IN</InputLabel>
                <Select value={clusterOptions?.policy_in || 'ACCEPT'} label="Policy IN" disabled>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Policy OUT</InputLabel>
                <Select value={clusterOptions?.policy_out || 'ACCEPT'} label="Policy OUT" disabled>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('monitoring.statistics')}</Typography>
            <Stack spacing={1}>
              {[
                { label: 'Security Groups', value: securityGroups.length },
                { label: t('networkPage.totalRulesLabel'), value: totalRules },
                { label: t('networkPage.clusterRulesLabel'), value: clusterRules.length },
                { label: 'Aliases', value: aliases.length },
                { label: 'IP Sets', value: ipsets.length },
                { label: t('networkPage.ipSetEntriesLabel'), value: totalIPSetEntries },
              ].map((stat, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', p: 1.5, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 1 }}>
                  <Typography variant="body2">{stat.label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{stat.value}</Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}
