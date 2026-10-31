'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { getDateLocale } from '@/lib/i18n/date'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import ProviderTenantGuard from '@/components/guards/ProviderTenantGuard'
import { Features } from '@/contexts/LicenseContext'
import {
  Alert,
  Box,
  CircularProgress,
  Grid,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
} from '@mui/material'

import { PageSkeleton } from '@/components/skeletons'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useResourceData } from './hooks/useResourceData'
import { useHistoryWindow } from './hooks/useHistoryWindow'
import { usePlanningAssumptions } from './hooks/usePlanningAssumptions'
import { useAiReading } from './hooks/useAiReading'
import type { ForecastInsights } from '@/lib/resources/forecastInsights'
import type { OptimizationPlan } from '@/lib/resources/optimizationPlan'
import { calculateImprovedPredictions } from './algorithms/improvedPrediction'
import { calculateHealthScoreWithDetails } from './algorithms/healthScore'
import {
  buildActionItems,
  computeClusterRunway,
  type ActionItem,
  type ActionSection,
  type ActionTab,
} from './algorithms/capacityPlanning'

import { RefreshIcon } from './components/icons'
import GlobalHealthScore from './components/GlobalHealthScore'
import PredictiveAlertsCard from './components/PredictiveAlertsCard'
import ProjectionChart from './components/ProjectionChart'
import GreenMetricsCard from './components/GreenMetricsCard'
import OverprovisioningCard from './components/OverprovisioningCard'
import ClusterSelector from './components/ClusterSelector'
import NetworkIoCard from './components/NetworkIoCard'
import VmDetailDrawer from './components/VmDetailDrawer'
import ActionList from './components/cockpit/ActionList'
import HealthTrendCard from './components/cockpit/HealthTrendCard'
import ClusterCapacityTable from './components/cockpit/ClusterCapacityTable'
import NodeHeatmap from './components/cockpit/NodeHeatmap'
import StoragePoolsTable from './components/cockpit/StoragePoolsTable'
import TopConsumersCard from './components/cockpit/TopConsumersCard'
import CapacitySimulator from './components/cockpit/CapacitySimulator'
import ForecastInsightsCard from './components/cockpit/ForecastInsightsCard'
import OptimizationPlanCard from './components/cockpit/OptimizationPlanCard'
import type { VmIdentity } from './types'

const TABS = ['capacity', 'simulation', 'efficiency', 'sustainability', 'ai'] as const

type PageTab = (typeof TABS)[number]

const isPageTab = (value: string | null | undefined): value is PageTab => TABS.includes(value as PageTab)

export default function ResourcesPage() {
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const { setPageInfo } = usePageTitle()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [selectedConnection, setSelectedConnection] = useState('all')
  const [drawerVm, setDrawerVm] = useState<VmIdentity | null>(null)
  const [historyDays, setHistoryDays] = useHistoryWindow()
  const [assumptions, setAssumptions] = usePlanningAssumptions()
  const tabParam = searchParams?.get('tab')
  const tab: PageTab = isPageTab(tabParam) ? tabParam : 'capacity'

  const {
    loading, error, kpis, trends, trendsPeriod, historyAvailableDays,
    topCpuVms, topRamVms, green, greenConfigured, overprovisioning,
    networkMetrics, connections, thresholds, storagePools, healthScoreHistory,
    clusters, nodes, stoppedAllocation,
    loadData,
  } = useResourceData(selectedConnection === 'all' ? undefined : selectedConnection, historyDays)

  useEffect(() => {
    setPageInfo(t('navigation.resources'), t('dashboard.widgets.resources'), 'ri-pie-chart-fill')
    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // The AI readings call a model: each one only once its tab is opened.
  const scopeId = selectedConnection === 'all' ? undefined : selectedConnection
  const forecast = useAiReading<ForecastInsights>('/api/v1/resources/forecast-insights', scopeId, Boolean(kpis) && tab === 'capacity')
  const plan = useAiReading<OptimizationPlan>('/api/v1/resources/optimization-plan', scopeId, Boolean(kpis) && tab === 'ai')

  const openTab = useCallback((next: PageTab | ActionTab) => {
    const url = new URL(window.location.href)

    url.searchParams.set('tab', next)
    router.replace(url.pathname + url.search, { scroll: false })
  }, [router])

  // A "To handle" item opens its tab, scrolls to its section and pulses its row.
  // The nonce makes a second click on the same item replay it.
  const [focus, setFocus] = useState<{ section: ActionSection; key?: string; nonce: number } | null>(null)
  const [simulatorPreset, setSimulatorPreset] = useState<{ clusterId?: string; nonce: number } | null>(null)

  const openAction = useCallback((item: ActionItem) => {
    const nonce = Date.now()

    openTab(item.tab)
    if (item.target.section === 'simulator') setSimulatorPreset({ clusterId: item.target.key, nonce })
    setFocus({ ...item.target, nonce })
  }, [openTab])

  useEffect(() => {
    if (!focus) return
    // The section only exists once the tab has rendered: wait for it, briefly.
    let tries = 0
    const timer = setInterval(() => {
      const target = document.getElementById(`cockpit-${focus.section}`) ?? document.getElementById('cockpit-tabs')
      if (target || ++tries > 40) {
        clearInterval(timer)
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 50)

    return () => clearInterval(timer)
  }, [focus])

  const rowFocus = (section: ActionSection) => (focus?.section === section && focus.key ? { key: focus.key, nonce: focus.nonce } : null)

  // Forecast with the thresholds configured in the settings, not the defaults.
  const { projectedTrends, alerts } = useMemo(() => {
    if (!kpis || trends.length === 0) return { projectedTrends: [], alerts: [] }
    return calculateImprovedPredictions(kpis, trends, thresholds, undefined, dateLocale)
  }, [kpis, trends, thresholds, dateLocale])

  const { healthScore, healthBreakdown } = useMemo(() => {
    if (!kpis) return { healthScore: 0, healthBreakdown: null }
    const result = calculateHealthScoreWithDetails(kpis, alerts, thresholds)
    return { healthScore: result.score, healthBreakdown: result.breakdown }
  }, [kpis, alerts, thresholds])

  const runways = useMemo(() => clusters.map(c => computeClusterRunway(c, thresholds, historyDays)), [clusters, thresholds, historyDays])
  const actions = useMemo(
    () => buildActionItems({ clusters, runways, nodes, pools: storagePools, stopped: stoppedAllocation, thresholds }),
    [clusters, runways, nodes, storagePools, stoppedAllocation, thresholds],
  )
  const multiCluster = clusters.length > 1

  const handleRefresh = () => {
    loadData()
  }

  const reportHref = `/api/v1/resources/report${selectedConnection === 'all' ? '' : `?connectionId=${encodeURIComponent(selectedConnection)}`}`

  return (
    <ProviderTenantGuard>
    <EnterpriseGuard requiredFeature={Features.GREEN_METRICS} featureName={t('resources.greenMetricsFeature')}>
      <Box sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap spacing={1}>
          <ClusterSelector connections={connections} value={selectedConnection} onChange={setSelectedConnection} />
          <Stack direction="row" spacing={1}>
            <Tooltip title={t('resources.exportPdf')} arrow>
              <span>
                <IconButton component="a" href={reportHref} download aria-label={t('resources.exportPdf')} disabled={loading || !kpis} color="primary">
                  <i className="ri-file-pdf-2-line" style={{ fontSize: 20 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('common.refresh')} arrow>
              <span>
                <IconButton aria-label={t('common.refresh')} onClick={handleRefresh} disabled={loading} color="primary">
                  {loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        {loading && !kpis ? (
          <PageSkeleton />
        ) : (
        <>
        {/* Cockpit: where the estate stands and what needs a decision */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <GlobalHealthScore score={healthScore} kpis={kpis} alerts={alerts} breakdown={healthBreakdown} loading={loading} />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <HealthTrendCard history={healthScoreHistory} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <ActionList items={actions} onOpen={openAction} />
          </Grid>
        </Grid>

        <Box id="cockpit-tabs" sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, scrollMarginTop: 88 }}>
          <Tabs value={tab} onChange={(_e, next: PageTab) => openTab(next)} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="capacity" label={t('resources.cockpit.tabs.capacity')} icon={<i className="ri-stack-line" />} iconPosition="start" />
            <Tab value="simulation" label={t('resources.cockpit.tabs.simulation')} icon={<i className="ri-flask-line" />} iconPosition="start" />
            <Tab value="efficiency" label={t('resources.cockpit.tabs.efficiency')} icon={<i className="ri-scales-3-line" />} iconPosition="start" />
            <Tab value="sustainability" label={t('resources.cockpit.tabs.sustainability')} icon={<i className="ri-leaf-line" />} iconPosition="start" />
            <Tab value="ai" label={t('resources.cockpit.tabs.ai')} icon={<i className="ri-sparkling-line" />} iconPosition="start" />
          </Tabs>
        </Box>

        {tab === 'capacity' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <ProjectionChart data={projectedTrends} loading={loading} period={trendsPeriod} windowDays={historyDays} availableDays={historyAvailableDays} onWindowDaysChange={setHistoryDays} />
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}>
              <PredictiveAlertsCard alerts={alerts} loading={loading} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ForecastInsightsCard
                insights={forecast.reading}
                loading={forecast.loading}
                failed={forecast.failed}
                onRegenerate={() => void forecast.regenerate()}
                nodes={nodes}
                isAllScope={selectedConnection === 'all'}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ClusterCapacityTable clusters={clusters} nodes={nodes} runways={runways} thresholds={thresholds} focus={rowFocus('clusters')} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <NodeHeatmap nodes={nodes} thresholds={thresholds} showClusters={multiCluster} focus={rowFocus('nodes')} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <StoragePoolsTable pools={storagePools} nodes={nodes} thresholds={thresholds} showClusters={multiCluster} focus={rowFocus('pools')} />
            </Grid>
          </Grid>
        )}

        {/* Single-card tabs sit in a grid too: a card with height 100% outside one
            stretches to the bottom of the page. */}
        {tab === 'simulation' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <CapacitySimulator
                key={simulatorPreset?.nonce ?? 0}
                initialScenario={simulatorPreset ? { addVms: 0, loseLargestNode: true, addNodes: 0 } : undefined}
                clusters={clusters}
                nodes={nodes}
                thresholds={thresholds}
                assumptions={assumptions}
                onAssumptionsChange={setAssumptions}
                initialClusterId={simulatorPreset?.clusterId ?? (selectedConnection === 'all' ? undefined : selectedConnection)}
              />
            </Grid>
          </Grid>
        )}

        {tab === 'efficiency' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <OverprovisioningCard data={overprovisioning} loading={loading} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TopConsumersCard topCpu={topCpuVms} topRam={topRamVms} thresholds={thresholds} onOpenVm={setDrawerVm} />
            </Grid>
            {networkMetrics && (
              <Grid size={{ xs: 12 }}>
                <NetworkIoCard metrics={networkMetrics} loading={loading} />
              </Grid>
            )}
          </Grid>
        )}

        {tab === 'sustainability' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <GreenMetricsCard green={green} greenConfigured={greenConfigured} loading={loading} />
            </Grid>
          </Grid>
        )}

        {tab === 'ai' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <OptimizationPlanCard plan={plan.reading} loading={plan.loading} failed={plan.failed} onRegenerate={() => void plan.regenerate()} onOpenVm={setDrawerVm} />
            </Grid>
          </Grid>
        )}

        <VmDetailDrawer vm={drawerVm} onClose={() => setDrawerVm(null)} />
        </>
        )}
      </Box>
    </EnterpriseGuard>
    </ProviderTenantGuard>
  )
}
