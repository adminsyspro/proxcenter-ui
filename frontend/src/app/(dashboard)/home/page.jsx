'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button } from '@mui/material'

import WidgetGrid from '@/components/dashboard/WidgetGrid'
import { usePageTitle } from '@/contexts/PageTitleContext'

function useTimeAgo() {
  const t = useTranslations('time')

  return (date) => {
    const now = new Date()
    const past = new Date(date)
    const diff = Math.floor((now - past) / 1000)

    if (diff < 60) return t('secondsAgo')
    if (diff < 3600) return t('minutesAgo', { count: Math.floor(diff / 60) })
    if (diff < 86400) return t('hoursAgo', { count: Math.floor(diff / 3600) })
    
return t('daysAgo', { count: Math.floor(diff / 86400) })
  }
}

export default function HomePage() {
  const t = useTranslations()
  const timeAgo = useTimeAgo()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const { setPageInfo } = usePageTitle()

  // Mettre à jour le titre dans le header
  useEffect(() => {
    setPageInfo(t('dashboard.title'), lastRefresh ? t('time.synced', { time: timeAgo(lastRefresh) }) : t('common.loading'), 'ri-dashboard-line')
  }, [lastRefresh, setPageInfo, t, timeAgo])

  // Nettoyer le titre quand on quitte la page
  useEffect(() => {
    return () => setPageInfo('', '', '')
  }, [setPageInfo])

  // Une seule requête pour tout le dashboard
  const fetchDashboard = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/dashboard', { cache: 'no-store' })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      setData(json.data)
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 30000)

    
return () => clearInterval(interval)
  }, [])

  if (error && !data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity='error'>{t('dashboard.loadingError')}: {error}</Alert>
        <Button variant='outlined' onClick={fetchDashboard} sx={{ mt: 2 }}>{t('common.retry')}</Button>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Widget Grid - avec boutons refresh et personnaliser */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <WidgetGrid data={data} loading={loading && !data} onRefresh={fetchDashboard} refreshLoading={loading} />
      </Box>
    </Box>
  )
}
