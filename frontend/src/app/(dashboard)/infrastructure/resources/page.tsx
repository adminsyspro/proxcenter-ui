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
import { calculateHealthScore } from './algorithms/healthScore'

import { RefreshIcon, SettingsIcon, SimulationIcon } from './components/icons'
import GlobalHealthScore from './components/GlobalHealthScore'
import PredictiveAlertsCard from './components/PredictiveAlertsCard'
import ProjectionChart from './components/ProjectionChart'
import TopVmsCompact from './components/TopVmsCompact'
import VmsDistribution from './components/VmsDistribution'
import GreenMetricsCard from './components/GreenMetricsCard'
import OverprovisioningCard from './components/OverprovisioningCard'
import AiInsightsCard from './components/AiInsightsCard'
import ClusterSelector from './components/ClusterSelector'
import BestNodeRecommendation from './components/BestNodeRecommendation'
import StoragePerPoolCard from './components/StoragePerPoolCard'
import NetworkIoCard from './components/NetworkIoCard'
import ThresholdsDialog from './components/ThresholdsDialog'
import WhatIfSimulatorDialog from './components/WhatIfSimulatorDialog'
import ExportMenu from './components/ExportMenu'

export default function ResourcesPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()

  // Cluster drill-down (F4)
  const [selectedConnection, setSelectedConnection] = useState('')

  // Data hook
  const {
    loading, error, kpis, trends, trendsPeriod,
    topCpuVms, topRamVms, green, overprovisioning,
    thresholds, storagePools, networkMetrics,
    healthScoreHistory, connections,
    aiAnalysis, loadData, runAiAnalysis, setAiAnalysis,
  } = useResourceData(selectedConnection || undefined)

  // Time range selectors (F2)
  const [historyRange, setHistoryRange] = useState(180)
  const [projectionRange, setProjectionRange] = useState(30)

  // Dialogs
  const [thresholdsOpen, setThresholdsOpen] = useState(false)
  const [simulatorOpen, setSimulatorOpen] = useState(false)

  // Current thresholds (can be overridden by user F9)
  const [currentThresholds, setCurrentThresholds] = useState(thresholds)
  useEffect(() => { setCurrentThresholds(thresholds) }, [thresholds])

  useEffect(() => {
    setPageInfo(t('navigation.resources'), t('dashboard.widgets.resources'), 'ri-pie-chart-fill')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Auto-trigger AI analysis on first load
  useEffect(() => {
    if (kpis && !aiAnalysis.summary && !aiAnalysis.loading) runAiAnalysis()
  }, [kpis])

  // Improved predictions with EWMA (F3) + configurable thresholds (F9) + variable projection range (F2)
  const { projectedTrends, alerts } = useMemo(() => {
    if (!kpis || trends.length === 0) return { projectedTrends: [], alerts: [] }
    return calculateImprovedPredictions(kpis, trends, currentThresholds, projectionRange)
  }, [kpis, trends, currentThresholds, projectionRange])

  // Health score uses configurable thresholds (F9)
  const healthScore = useMemo(() => {
    if (!kpis) return 0
    return calculateHealthScore(kpis, alerts, currentThresholds)
  }, [kpis, alerts, currentThresholds])

  const handleRefresh = () => {
    loadData()
    setAiAnalysis({ summary: '', recommendations: [], loading: false })
  }

  return (
    <EnterpriseGuard requiredFeature={Features.GREEN_METRICS} featureName="Green Metrics / RSE">
      <Box sx={{ p: 3 }} id="resource-planner-content">
        {/* Toolbar */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap spacing={1}>
          {/* Left: cluster selector (F4) */}
          <ClusterSelector
            connections={connections}
            value={selectedConnection}
            onChange={setSelectedConnection}
          />

          {/* Right: action buttons */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              size="small"
              startIcon={<SimulationIcon />}
              onClick={() => setSimulatorOpen(true)}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {t('resources.whatIf')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<SettingsIcon />}
              onClick={() => setThresholdsOpen(true)}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {t('resources.thresholds')}
            </Button>
            <ExportMenu
              kpis={kpis}
              trends={projectedTrends}
              topCpuVms={topCpuVms}
              topRamVms={topRamVms}
              overprovisioning={overprovisioning}
            />
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
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {/* Health Score (F8 sparkline included) */}
        <Box sx={{ mb: 3 }}>
          <GlobalHealthScore
            score={healthScore}
            kpis={kpis}
            alerts={alerts}
            loading={loading}
            history={healthScoreHistory}
          />
        </Box>

        <Grid container spacing={3}>
          {/* Projection Chart with time range selectors (F2) + configurable thresholds (F9) */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <ProjectionChart
              data={projectedTrends}
              loading={loading}
              period={trendsPeriod}
              thresholds={currentThresholds}
              historyRange={historyRange}
              projectionRange={projectionRange}
              onHistoryRangeChange={setHistoryRange}
              onProjectionRangeChange={setProjectionRange}
            />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <PredictiveAlertsCard alerts={alerts} loading={loading} />
          </Grid>

          {/* Best Node Recommendation (F10) + Top VMs + VM Distribution */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack spacing={3}>
              <BestNodeRecommendation overprovisioning={overprovisioning} />
              <VmsDistribution kpis={kpis} loading={loading} />
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            <TopVmsCompact cpuVms={topCpuVms} ramVms={topRamVms} loading={loading} />
          </Grid>

          {/* Storage per pool (F5) */}
          {storagePools.length > 0 && (
            <Grid size={{ xs: 12, lg: 6 }}>
              <StoragePerPoolCard pools={storagePools} loading={loading} />
            </Grid>
          )}

          {/* Network I/O (F6) */}
          {networkMetrics && (
            <Grid size={{ xs: 12, lg: storagePools.length > 0 ? 6 : 12 }}>
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

      {/* Dialogs */}
      <ThresholdsDialog
        open={thresholdsOpen}
        onClose={() => setThresholdsOpen(false)}
        thresholds={currentThresholds}
        onSave={setCurrentThresholds}
      />
      <WhatIfSimulatorDialog
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        kpis={kpis}
        overprovisioning={overprovisioning}
        thresholds={currentThresholds}
      />
    </EnterpriseGuard>
  )
}
