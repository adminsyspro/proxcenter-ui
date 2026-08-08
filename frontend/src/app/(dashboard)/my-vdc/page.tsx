'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Typography, Alert, Stack, Card, CardActionArea, Chip, Button } from '@mui/material'

import MyVdcOverview from '@/components/mydc/MyVdcOverview'
import QuotaDonut from '@/components/mydc/QuotaDonut'
import { readVdcContextCookie, setVdcContextCookie } from '@/lib/vdc/contextCookie'

export default function MyVdcPage() {
  const t = useTranslations()
  const [vdcs, setVdcs] = useState<any[]>([])
  const [selectedVdcId, setSelectedVdcId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `silent` keeps the layout stable on focus-driven refetches: only the very
  // first load flips the full-page loader; later refreshes show a small spinner
  // inside the quotas card so values update in place without a flash.
  const loadVdcs = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)

    try {
      const res = await fetch('/api/v1/vdcs', { cache: 'no-store' })
      const json = await res.json()
      const list = Array.isArray(json.data) ? json.data : []

      setVdcs(list)
      // Single-vDC tenants keep the direct overview; multi-vDC tenants land
      // on the cards grid (selectedVdcId stays '' until a card is clicked).
      // active[0] first (a disabled vDC must not shadow the active one),
      // list[0] as last resort so a disabled-only tenant keeps today's view.
      const active = list.filter((v: any) => v.enabled !== false)
      // Precise vDC context → land directly on that vDC's dashboard (skip the
      // cards grid). Only an ACTIVE vDC matching the cookie counts; otherwise
      // fall back to the aggregated cards (multi) / direct overview (mono).
      const ctx = readVdcContextCookie()
      const ctxVdc = ctx ? active.find((v: any) => v.id === ctx) : undefined
      setSelectedVdcId(prev =>
        prev || (ctxVdc?.id ?? (active.length <= 1 ? (active[0]?.id ?? list[0]?.id ?? '') : ''))
      )
      setError(null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (silent) setRefreshing(false)
      else setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadVdcs(false)
  }, [loadVdcs])

  // Refetch when the tab regains focus. /api/v1/vdcs revalidates the usage
  // cache once it's older than 15 s, so coming back to the page after creating
  // a snapshot / VM / backup elsewhere picks up the new counts without a hard
  // reload. Skipped while the document is hidden to avoid background polling.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadVdcs(true)
    }

    document.addEventListener('visibilitychange', onVisible)

    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadVdcs])

  if (loading) return <Box p={3}>{t('common.loading')}</Box>
  if (error) return <Box p={3}><Alert severity="error">{error}</Alert></Box>
  if (vdcs.length === 0) {
    return (
      <Box p={3}>
        <Typography variant="h5" gutterBottom>{t('myVdc.title')}</Typography>
        <Alert severity="info">{t('myVdc.noVdcs')}</Alert>
      </Box>
    )
  }

  const activeVdcs = vdcs.filter((v) => v.enabled !== false)
  const selectedVdc = vdcs.find((v) => v.id === selectedVdcId)
  const contextId = readVdcContextCookie()
  const formatMbAsGb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`
  const unlimitedLabel = t('vdc.quotaUnlimited')

  const openVdc = (v: any) => {
    // Card click = set the global context AND open the overview locally.
    // No reload needed here: the next server-rendered navigation picks the
    // cookie up; the local overview is already vDC-scoped by construction.
    setVdcContextCookie(v.id)
    setSelectedVdcId(v.id)
  }

  // Multi-vDC landing: one card per active vDC, Cloud Director style.
  if (activeVdcs.length > 1 && !selectedVdc) {
    return (
      <Box sx={{ px: 3, pb: 3, pt: 0 }}>
        <Typography variant="h5" gutterBottom>{t('vdc.title')}</Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 2,
          }}
        >
          {activeVdcs.map((v) => {
            const usage = v.usage || {}
            const quota = v.quota || {}
            const isContext = v.id === contextId

            return (
              <Card key={v.id} variant="outlined" sx={{ position: 'relative' }}>
                <CardActionArea onClick={() => openVdc(v)} sx={{ p: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
                    <Box component="i" className="ri-cloud-line" sx={{ fontSize: 22, color: 'primary.main' }} />
                    <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ flexGrow: 1 }}>
                      {v.name}
                    </Typography>
                    {isContext && (
                      <Chip size="small" color="primary" variant="outlined" label={t('myVdc.currentContext')} sx={{ height: 20, fontSize: '0.7rem' }} />
                    )}
                  </Stack>
                  <Stack direction="row" spacing={2} justifyContent="center" mb={1.5}>
                    <QuotaDonut icon="ri-cpu-line" size={64} used={usage.usedVcpus || 0} max={quota.maxVcpus} unlimitedLabel={unlimitedLabel} />
                    <QuotaDonut icon="ri-ram-2-line" size={64} used={usage.usedRamMb || 0} max={quota.maxRamMb ?? null} formatValue={formatMbAsGb} unlimitedLabel={unlimitedLabel} />
                    <QuotaDonut icon="ri-hard-drive-2-line" size={64} used={usage.usedStorageMb || 0} max={quota.maxStorageMb ?? null} formatValue={formatMbAsGb} unlimitedLabel={unlimitedLabel} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    {t('myVdc.vmCount', { count: usage.usedVms || 0 })}
                  </Typography>
                </CardActionArea>
              </Card>
            )
          })}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ px: 3, pb: 3, pt: 0 }}>
      {activeVdcs.length > 1 && (
        <Button
          size="small"
          startIcon={<i className="ri-arrow-left-line" style={{ fontSize: 16 }} />}
          onClick={() => setSelectedVdcId('')}
          sx={{ mb: 1, textTransform: 'none' }}
        >
          {t('myVdc.backToVdcList')}
        </Button>
      )}
      {selectedVdc && (
        <MyVdcOverview
          vdc={selectedVdc}
          onRefresh={() => loadVdcs(true)}
          refreshing={refreshing}
        />
      )}
    </Box>
  )
}
