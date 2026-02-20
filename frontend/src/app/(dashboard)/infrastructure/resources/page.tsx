'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import { getDateLocale } from '@/lib/i18n/date'
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

import { PageSkeleton } from '@/components/skeletons'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useResourceData } from './hooks/useResourceData'
import { calculateImprovedPredictions } from './algorithms/improvedPrediction'
import { calculateHealthScoreWithDetails } from './algorithms/healthScore'

import { RefreshIcon } from './components/icons'
import { exportResourcesPdf } from './lib/exportPdf'
import GlobalHealthScore from './components/GlobalHealthScore'
import PredictiveAlertsCard from './components/PredictiveAlertsCard'
import ProjectionChart from './components/ProjectionChart'
import GreenMetricsCard from './components/GreenMetricsCard'
import OverprovisioningCard from './components/OverprovisioningCard'
import AiInsightsCard from './components/AiInsightsCard'
import ClusterSelector from './components/ClusterSelector'
import NetworkIoCard from './components/NetworkIoCard'
import VmDetailDrawer from './components/VmDetailDrawer'
import type { VmIdentity } from './types'

export default function ResourcesPage() {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const { setPageInfo } = usePageTitle()

  // Cluster drill-down (F4)
  const [selectedConnection, setSelectedConnection] = useState('all')
  const [exporting, setExporting] = useState(false)
  const [drawerVm, setDrawerVm] = useState<VmIdentity | null>(null)

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
    if (kpis && !aiAnalysis.summary && !aiAnalysis.summaryKey && !aiAnalysis.loading) runAiAnalysis()
  }, [kpis])

  // Improved predictions with EWMA (F3)
  const { projectedTrends, alerts } = useMemo(() => {
    if (!kpis || trends.length === 0) return { projectedTrends: [], alerts: [] }
    return calculateImprovedPredictions(kpis, trends, undefined, undefined, dateLocale)
  }, [kpis, trends, dateLocale])

  const { healthScore, healthBreakdown } = useMemo(() => {
    if (!kpis) return { healthScore: 0, healthBreakdown: null }
    const result = calculateHealthScoreWithDetails(kpis, alerts)
    return { healthScore: result.score, healthBreakdown: result.breakdown }
  }, [kpis, alerts])

  const handleRefresh = () => {
    loadData()
    setAiAnalysis({ summary: '', recommendations: [], loading: false })
  }

  const handleExportPdf = useCallback(async () => {
    if (!kpis || !healthBreakdown) return
    setExporting(true)
    try {
      await exportResourcesPdf({
        kpis,
        healthScore,
        healthBreakdown,
        alerts,
        overprovisioning,
        green,
        networkMetrics,
        topCpuVms,
        topRamVms,
      })
    } finally {
      setExporting(false)
    }
  }, [kpis, healthScore, healthBreakdown, alerts, overprovisioning, green, networkMetrics, topCpuVms, topRamVms])

  return (
    <EnterpriseGuard requiredFeature={Features.GREEN_METRICS} featureName={t('resources.greenMetricsFeature')}>
      <Box sx={{ p: 3 }}>
        {/* Toolbar */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap spacing={1}>
          {/* Left: cluster selector */}
          <ClusterSelector
            connections={connections}
            value={selectedConnection}
            onChange={setSelectedConnection}
          />

          {/* Right: actions */}
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={exporting ? <CircularProgress size={16} /> : <i className="ri-file-pdf-2-line" style={{ fontSize: 18 }} />}
              onClick={handleExportPdf}
              disabled={exporting || loading || !kpis}
              sx={{ borderRadius: 2 }}
            >
              {t('resources.exportPdf')}
            </Button>
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

        {loading && !kpis ? (
          <PageSkeleton />
        ) : (
        <>
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

        <VmDetailDrawer vm={drawerVm} onClose={() => setDrawerVm(null)} />
        </>
        )}
      </Box>
    </EnterpriseGuard>
  )
}
