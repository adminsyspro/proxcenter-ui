'use client'

import { useEffect, useState, useMemo } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Card,
  CircularProgress,
  Snackbar,
  Tab,
  Tabs,
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useLicense, Features } from '@/contexts/LicenseContext'

import ReportGenerator from './components/ReportGenerator'
import ReportHistory from './components/ReportHistory'
import ScheduleManager from './components/ScheduleManager'

interface ReportType {
  type: string
  name: string
  description: string
  sections: Array<{
    id: string
    name: string
    description: string
  }>
}

interface Report {
  id: string
  type: string
  name: string
  status: 'pending' | 'generating' | 'completed' | 'failed'
  file_path?: string
  file_size?: number
  date_from: string
  date_to: string
  connection_ids?: string[]
  sections?: string[]
  schedule_id?: string
  generated_by: string
  error?: string
  created_at: string
  completed_at?: string
}

interface Schedule {
  id: string
  name: string
  enabled: boolean
  type: string
  frequency: 'daily' | 'weekly' | 'monthly'
  day_of_week?: number
  day_of_month?: number
  time_of_day: string
  connection_ids?: string[]
  sections?: string[]
  recipients: string[]
  last_run_at?: string
  next_run_at?: string
  created_at: string
}

export default function ReportsPage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const { hasFeature, isLicensed } = useLicense()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' })

  // Data
  const [reportTypes, setReportTypes] = useState<ReportType[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [languages, setLanguages] = useState<Array<{ code: string; name: string }>>([
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
  ])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setPageInfo(t('reports.title'), t('reports.description'), 'ri-file-chart-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const loadData = async () => {
    try {
      setLoading(true)

      const [typesRes, reportsRes, schedulesRes, langsRes] = await Promise.all([
        fetch('/api/v1/orchestrator/reports/types', { cache: 'no-store' }),
        fetch('/api/v1/orchestrator/reports?limit=100', { cache: 'no-store' }),
        fetch('/api/v1/orchestrator/reports/schedules', { cache: 'no-store' }),
        fetch('/api/v1/orchestrator/reports/languages', { cache: 'no-store' }),
      ])

      if (typesRes.ok) {
        const typesData = await typesRes.json()

        setReportTypes(Array.isArray(typesData) ? typesData : [])
      }

      if (reportsRes.ok) {
        const reportsData = await reportsRes.json()

        setReports(reportsData.data || [])
      }

      if (schedulesRes.ok) {
        const schedulesData = await schedulesRes.json()

        setSchedules(Array.isArray(schedulesData) ? schedulesData : [])
      }

      if (langsRes.ok) {
        const langsData = await langsRes.json()

        if (Array.isArray(langsData) && langsData.length > 0) {
          setLanguages(langsData)
        }
      }
    } catch (e) {
      console.error('Error loading reports data:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasFeature(Features.REPORTS)) {
      loadData()

      // Refresh every 30 seconds
      const interval = setInterval(loadData, 30000)

      return () => clearInterval(interval)
    }
  }, [hasFeature])

  const handleGenerateReport = async (request: any) => {
    try {
      const res = await fetch('/api/v1/orchestrator/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.reportStarted'), severity: 'success' })
        loadData()
        setTab(1) // Switch to history tab
      } else {
        const error = await res.json()

        setSnackbar({ open: true, message: error.error || t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleDeleteReport = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/orchestrator/reports/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('common.success'), severity: 'success' })
        loadData()
      } else {
        setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleCreateSchedule = async (request: any) => {
    try {
      const res = await fetch('/api/v1/orchestrator/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleCreated'), severity: 'success' })
        loadData()
      } else {
        const error = await res.json()

        setSnackbar({ open: true, message: error.error || t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleUpdateSchedule = async (id: string, request: any) => {
    try {
      const res = await fetch(`/api/v1/orchestrator/reports/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleUpdated'), severity: 'success' })
        loadData()
      } else {
        const error = await res.json()

        setSnackbar({ open: true, message: error.error || t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/orchestrator/reports/schedules/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleDeleted'), severity: 'success' })
        loadData()
      } else {
        setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleRunScheduleNow = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/orchestrator/reports/schedules/${id}/run`, {
        method: 'POST',
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleRunStarted'), severity: 'success' })
        loadData()
        setTab(1) // Switch to history tab
      } else {
        const error = await res.json()

        setSnackbar({ open: true, message: error.error || t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  if (!mounted) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!hasFeature(Features.REPORTS)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          {t('license.featureNotAvailable')}
        </Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      <Card variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label={t('reports.generate')} />
            <Tab label={`${t('reports.history')} (${reports.length})`} />
            <Tab label={`${t('reports.schedules')} (${schedules.length})`} />
          </Tabs>
        </Box>

        {tab === 0 && (
          <ReportGenerator
            reportTypes={reportTypes}
            languages={languages}
            onGenerate={handleGenerateReport}
            loading={loading}
          />
        )}

        {tab === 1 && (
          <ReportHistory
            reports={reports}
            onDelete={handleDeleteReport}
            onRefresh={loadData}
            loading={loading}
          />
        )}

        {tab === 2 && (
          <ScheduleManager
            schedules={schedules}
            reportTypes={reportTypes}
            onCreate={handleCreateSchedule}
            onUpdate={handleUpdateSchedule}
            onDelete={handleDeleteSchedule}
            onRunNow={handleRunScheduleNow}
            loading={loading}
          />
        )}
      </Card>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
