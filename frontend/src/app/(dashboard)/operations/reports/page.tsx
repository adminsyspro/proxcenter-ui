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
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { useReportsData } from '@/hooks/useReports'

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
  const { hasFeature, isLicensed, isEnterprise } = useLicense()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState(0)
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' })

  // Data
  const { data: reportsData, mutate: mutateReports, isLoading: loading } = useReportsData(isEnterprise, 30000)

  const reportTypes = reportsData?.reportTypes || []
  const reports = reportsData?.reports || []
  const schedules = reportsData?.schedules || []
  const languages = reportsData?.languages || [{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }]

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setPageInfo(t('reports.title'), t('reports.description'), 'ri-file-chart-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const handleGenerateReport = async (request: any) => {
    if (!isEnterprise) return

    try {
      const res = await fetch('/api/v1/orchestrator/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.reportStarted'), severity: 'success' })
        mutateReports()
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
    if (!isEnterprise) return

    try {
      const res = await fetch(`/api/v1/orchestrator/reports/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('common.success'), severity: 'success' })
        mutateReports()
      } else {
        setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleCreateSchedule = async (request: any) => {
    if (!isEnterprise) return

    try {
      const res = await fetch('/api/v1/orchestrator/reports/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleCreated'), severity: 'success' })
        mutateReports()
      } else {
        const error = await res.json()

        setSnackbar({ open: true, message: error.error || t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleUpdateSchedule = async (id: string, request: any) => {
    if (!isEnterprise) return

    try {
      const res = await fetch(`/api/v1/orchestrator/reports/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleUpdated'), severity: 'success' })
        mutateReports()
      } else {
        const error = await res.json()

        setSnackbar({ open: true, message: error.error || t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    if (!isEnterprise) return

    try {
      const res = await fetch(`/api/v1/orchestrator/reports/schedules/${id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleDeleted'), severity: 'success' })
        mutateReports()
      } else {
        setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
      }
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error'), severity: 'error' })
    }
  }

  const handleRunScheduleNow = async (id: string) => {
    if (!isEnterprise) return

    try {
      const res = await fetch(`/api/v1/orchestrator/reports/schedules/${id}/run`, {
        method: 'POST',
      })

      if (res.ok) {
        setSnackbar({ open: true, message: t('reports.scheduleRunStarted'), severity: 'success' })
        mutateReports()
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

  // EnterpriseGuard gère déjà l'affichage pour les utilisateurs non-Enterprise

  return (
    <EnterpriseGuard requiredFeature={Features.REPORTS} featureName="Reports">
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
            onRefresh={() => mutateReports()}
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
    </EnterpriseGuard>
  )
}
