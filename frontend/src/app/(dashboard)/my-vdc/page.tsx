'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Typography, Alert } from '@mui/material'

import MyVdcOverview from '@/components/mydc/MyVdcOverview'
import VdcSummaryCard from '@/components/mydc/VdcSummaryCard'
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

  const openVdc = (v: any) => {
    // Card click = choose this vDC as the global context, exactly like the
    // header VdcSwitcher: set the cookie and reload so every page/API narrows
    // to it. The header switcher stays the single control for context — no
    // in-page navigation state to keep in sync.
    setVdcContextCookie(v.id)
    window.location.reload()
  }

  // Multi-vDC landing: one full-width row per active vDC.
  if (activeVdcs.length > 1 && !selectedVdc) {
    const totalVms = activeVdcs.reduce((n, v) => n + (v.usage?.usedVms || 0), 0)

    return (
      <Box sx={{ px: 3, pb: 3, pt: 0 }}>
        <Typography variant="h5">{t('vdc.title')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          {t('myVdc.grid.summary', { vdcs: activeVdcs.length, vms: totalVms })}
        </Typography>
        <Box sx={{ display: 'grid', gap: 2 }}>
          {activeVdcs.map((v) => (
            <VdcSummaryCard key={v.id} vdc={v} isContext={v.id === contextId} onOpen={() => openVdc(v)} />
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ px: 3, pb: 3, pt: 0 }}>
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
