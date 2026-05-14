'use client'

import { useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Typography, MenuItem, Select, FormControl, InputLabel, Alert, Stack } from '@mui/material'

import MyVdcOverview from '@/components/mydc/MyVdcOverview'

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
      setSelectedVdcId(prev => prev || (list[0]?.id ?? ''))
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

  const selectedVdc = vdcs.find((v) => v.id === selectedVdcId)

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

  return (
    <Box sx={{ px: 3, pb: 3, pt: 0 }}>
      {vdcs.length > 1 && (
        <Stack direction="row" alignItems="center" spacing={2} mb={2}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>{t('myVdc.selectVdc')}</InputLabel>
            <Select
              value={selectedVdcId}
              label={t('myVdc.selectVdc')}
              onChange={(e) => setSelectedVdcId(e.target.value)}
            >
              {vdcs.map((v) => (
                <MenuItem key={v.id} value={v.id}>{v.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
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
