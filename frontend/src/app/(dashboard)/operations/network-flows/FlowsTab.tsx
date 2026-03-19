'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'

interface FlowsTabProps {
  connectionId: string
  connectionName?: string
}

export default function FlowsTab({ connectionId, connectionName }: FlowsTabProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [subTab, setSubTab] = useState(0)

  // Placeholder state — will be replaced with real data from sFlow API
  const [sflowEnabled, setSflowEnabled] = useState(true) // TODO: check via GET /sflow/status
  const [configuring, setConfiguring] = useState(false)

  const primaryColor = theme.palette.primary.main

  // ── Not configured state ──
  if (!sflowEnabled) {
    return (
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 3 }}>
        <Box sx={{
          width: 80, height: 80, borderRadius: '50%',
          bgcolor: `${primaryColor}14`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="ri-flow-chart" style={{ fontSize: 36, color: primaryColor }} />
        </Box>
        <Box sx={{ textAlign: 'center', maxWidth: 500 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
            {t('networkFlows.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('networkFlows.setupDescription')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={configuring ? <CircularProgress size={20} color="inherit" /> : <i className="ri-settings-3-line" />}
          disabled={configuring}
          onClick={async () => {
            setConfiguring(true)
            // TODO: POST /api/v1/orchestrator/sflow/configure
            setTimeout(() => {
              setSflowEnabled(true)
              setConfiguring(false)
            }, 2000)
          }}
        >
          {configuring ? t('networkFlows.configuring') : t('networkFlows.enableSflow')}
        </Button>
        <Alert severity="info" sx={{ maxWidth: 500 }}>
          <Typography variant="caption">
            {t('networkFlows.requiresOvs')}
          </Typography>
        </Alert>
      </Box>
    )
  }

  // ── sFlow active — show flow data ──
  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          icon={<i className="ri-dashboard-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.overview')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-git-branch-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.dependencyGraph')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-line-chart-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.timeSeries')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-shield-cross-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.security')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
        <Tab
          icon={<i className="ri-server-line" style={{ fontSize: 16 }} />}
          iconPosition="start"
          label={t('networkFlows.infrastructure')}
          sx={{ textTransform: 'none', fontSize: 13 }}
        />
      </Tabs>

      {/* Overview sub-tab */}
      {subTab === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* KPI Cards */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.flowRate')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">—</Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.flowsPerSecond')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.activeVms')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">—</Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.withTraffic')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.totalBandwidth')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">—</Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.currentWindow')}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.agents')}</Typography>
                <Typography variant="h5" fontWeight={800} color="primary">—</Typography>
                <Typography variant="caption" color="text.secondary">{t('networkFlows.sflowAgents')}</Typography>
              </CardContent>
            </Card>
          </Box>

          {/* Top Talkers + Top Pairs side by side */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>

            {/* Top Talkers */}
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    <i className="ri-bar-chart-horizontal-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.topTalkers')}
                  </Typography>
                  <Chip label="5m" size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.4 }}>
                  <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                </Box>
              </CardContent>
            </Card>

            {/* Top Pairs */}
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    <i className="ri-arrow-left-right-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.topPairs')}
                  </Typography>
                  <Chip label="5m" size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.4 }}>
                  <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
                </Box>
              </CardContent>
            </Card>
          </Box>

          {/* Top Ports */}
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  <i className="ri-router-line" style={{ fontSize: 16, marginRight: 6 }} />
                  {t('networkFlows.topPorts')}
                </Typography>
                <Chip label="5m" size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, opacity: 0.4 }}>
                <Typography variant="body2">{t('networkFlows.waitingForData')}</Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Dependency Graph sub-tab */}
      {subTab === 1 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-git-branch-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.graphComingSoon')}</Typography>
          </Box>
        </Box>
      )}

      {/* Time Series sub-tab */}
      {subTab === 2 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-line-chart-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.timeSeriesComingSoon')}</Typography>
          </Box>
        </Box>
      )}

      {/* Security sub-tab */}
      {subTab === 3 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-shield-cross-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.securityComingSoon')}</Typography>
          </Box>
        </Box>
      )}

      {/* Infrastructure sub-tab */}
      {subTab === 4 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
            <i className="ri-server-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.infraComingSoon')}</Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}
