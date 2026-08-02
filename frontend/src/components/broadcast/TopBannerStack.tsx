'use client'

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Box } from '@mui/material'

import DemoBanner, { isDemoMode } from '@/components/DemoBanner'
import { useBroadcasts } from '@/hooks/useBroadcasts'
import { useDismissedBroadcasts } from '@/hooks/useDismissedBroadcasts'
import BroadcastBanner from './BroadcastBanner'
import { TOP_BANNER_Z_INDEX, publishBannerHeight } from './bannerHeight'

/**
 * The one fixed element at the top of the dashboard. It stacks the demo row
 * and every active broadcast, then publishes its own height as
 * --top-banner-height so the layout can make room (see
 * StyledContentWrapper and StyledHeader). Nothing else writes that property.
 */
export default function TopBannerStack() {
  const ref = useRef<HTMLDivElement | null>(null)
  const { banners } = useBroadcasts()
  const { visible, dismiss } = useDismissedBroadcasts(banners)

  const demo = isDemoMode()
  const rowCount = visible.length + (demo ? 1 : 0)

  const measure = useCallback(() => {
    publishBannerHeight(rowCount === 0 ? null : (ref.current?.offsetHeight ?? 0))
  }, [rowCount])

  useLayoutEffect(() => {
    measure()
    return () => publishBannerHeight(null)
  }, [measure])

  // A long message wraps differently as the viewport changes, so re-measure
  // on resize. jsdom stubs ResizeObserver with a no-op, which is why the
  // tests assert the published/cleared contract rather than a pixel value.
  useEffect(() => {
    if (rowCount === 0 || typeof ResizeObserver === 'undefined') return
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, rowCount])

  if (rowCount === 0) return null

  return (
    <Box
      ref={ref}
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: TOP_BANNER_Z_INDEX,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <DemoBanner />
      {visible.map(banner => (
        <BroadcastBanner key={banner.id} banner={banner} onDismiss={dismiss} />
      ))}
    </Box>
  )
}
