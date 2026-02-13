'use client'

import { useEffect, useState, useMemo } from 'react'

import { useTranslations } from 'next-intl'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Stack,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useResourceData } from './hooks/useResourceData'
import { calculateImprovedPredictions } from './algorithms/improvedPrediction'
import { calculateHealthScoreWithDetails } from './algorithms/healthScore'

import { RefreshIcon } from './components/icons'
import GlobalHealthScore from './components/GlobalHealthScore'
import PredictiveAlertsCard from './components/PredictiveAlertsCard'
import ProjectionChart from './components/ProjectionChart'
import GreenMetricsCard from './components/GreenMetricsCard'
import OverprovisioningCard from './components/OverprovisioningCard'
import AiInsightsCard from './components/AiInsightsCard'
import ClusterSelector from './components/ClusterSelector'
import NetworkIoCard from './components/NetworkIoCard'

export default function ResourcesPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  // Cluster drill-down (F4)
  const [selectedConnection, setSelectedConnection] = useState('all')

  // Data hook
  const {
    loading, error, kpis, trends, trendsPeriod,
    topCpuVms, topRamVms, green, overprovisioning,
    networkMetrics, connections,
    aiAnalysis, loadData, runAiAnalysis, setAiAnalysis,
  } = useResourceData(selectedConnection === 'all' ? undefined : selectedConnection)

  useEffect(() => {
    setPageInfo(t('navigation.resources'), t('dashboard.widgets.resources'), 'ri-pie-chart-fill')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Auto-trigger AI analysis on first load
  useEffect(() => {
    if (kpis && !aiAnalysis.summary && !aiAnalysis.loading) runAiAnalysis()
  }, [kpis])

  // Improved predictions with EWMA (F3)
  const { projectedTrends, alerts } = useMemo(() => {
    if (!kpis || trends.length === 0) return { projectedTrends: [], alerts: [] }
    return calculateImprovedPredictions(kpis, trends)
  }, [kpis, trends])

  const { healthScore, healthBreakdown } = useMemo(() => {
    if (!kpis) return { healthScore: 0, healthBreakdown: null }
    const result = calculateHealthScoreWithDetails(kpis, alerts)
    return { healthScore: result.score, healthBreakdown: result.breakdown }
  }, [kpis, alerts])

  const handleRefresh = () => {
    loadData()
    setAiAnalysis({ summary: '', recommendations: [], loading: false })
  }

  return (
    <EnterpriseGuard requiredFeature={Features.GREEN_METRICS} featureName="Green Metrics / RSE">
      <Box sx={{ p: 3 }}>
        {/* Toolbar */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap spacing={1}>
          {/* Left: cluster selector */}
          <ClusterSelector
            connections={connections}
            value={selectedConnection}
            onChange={setSelectedConnection}
          />

          {/* Right: refresh */}
          <Button
            variant="outlined"
            startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={handleRefresh}
            disabled={loading}
            sx={{ borderRadius: 2 }}
          >
            {t('common.refresh')}
          </Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <Box sx={{ mb: 3 }}>
          <GlobalHealthScore score={healthScore} kpis={kpis} alerts={alerts} breakdown={healthBreakdown} loading={loading} />
        </Box>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <ProjectionChart data={projectedTrends} loading={loading} period={trendsPeriod} />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <PredictiveAlertsCard alerts={alerts} loading={loading} />
          </Grid>

          {/* Network I/O (F6) */}
          {networkMetrics && (
            <Grid size={{ xs: 12 }}>
              <NetworkIoCard metrics={networkMetrics} loading={loading} />
            </Grid>
          )}

          {/* Green / RSE */}
          <Grid size={{ xs: 12 }}>
            <GreenMetricsCard green={green} loading={loading} />
          </Grid>

          {/* Overprovisioning */}
          <Grid size={{ xs: 12 }}>
            <OverprovisioningCard data={overprovisioning} loading={loading} />
          </Grid>

          {/* AI Insights */}
          <Grid size={{ xs: 12 }}>
            <AiInsightsCard analysis={aiAnalysis} onAnalyze={runAiAnalysis} loading={loading} />
          </Grid>
        </Grid>
      </Box>
    </EnterpriseGuard>
  )
}
