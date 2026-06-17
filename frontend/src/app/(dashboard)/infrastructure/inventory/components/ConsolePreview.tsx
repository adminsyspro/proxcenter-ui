'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { getOsSvgIcon } from '@/lib/utils/osIcons'

import {
  Box,
  CircularProgress,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material'

function ConsolePreview({
  height = 210,
  connId,
  node,
  type,
  vmid,
  vmStatus,
  osInfo,
  osLoading,
  spiceCapable,
}: {
  height?: number | string
  connId?: string
  node?: string
  type?: string
  vmid?: string
  vmStatus?: string
  osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null
  osLoading?: boolean
  spiceCapable?: boolean
}) {
  const t = useTranslations()
  const isRunning = vmStatus?.toLowerCase() === 'running'
  const isQemu = type === 'qemu'
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotFailed, setScreenshotFailed] = useState(false)
  const [noDisplay, setNoDisplay] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Tracks the active blob: object URL so we can revoke the previous frame and
  // avoid leaking one Blob per 10s poll.
  const objectUrlRef = useRef<string | null>(null)

  const isLxc = type === 'lxc'
  const base = connId && node && type && vmid
    ? `connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`
    : null

  const openConsole = (page: 'novnc' | 'spice') => {
    if (!base) return
    window.open(
      `/${page}/console.html?${base}`,
      `console-${page}-${vmid}`,
      'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
    )
  }
  const handleOpenConsole = () => openConsole('novnc')

  const fetchScreenshot = useCallback(async () => {
    if (!connId || !node || !type || !vmid || !isRunning || !isQemu) return

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${encodeURIComponent(type)}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/screenshot`
      )
      const contentType = res.headers.get('content-type') || ''

      // Happy path: the server returns a ready-to-display JPEG (re-encoded from
      // the node's PPM). Swap it in via a blob URL and revoke the previous one.
      if (res.ok && contentType.startsWith('image/')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = url
        setScreenshotUrl(url)
        setScreenshotFailed(false)
        return
      }

      // Otherwise it's a JSON status (no_display, ssh_failed, decode_failed, ...).
      const json = await res.json().catch(() => null)

      // Serial-only / headless VM: no graphical framebuffer to capture, ever.
      // Stop polling so we don't hammer a guaranteed-failing screendump every
      // 10s, and let the render show a "serial console" badge.
      if (json?.reason === 'no_display') {
        setNoDisplay(true)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        return
      }

      // Transient failure - keep the existing frame, mark failed for fresh attempts.
      setScreenshotFailed(true)
    } catch {
      setScreenshotFailed(true)
    }
  }, [connId, node, type, vmid, isRunning, isQemu])

  // Fetch screenshot on mount and every 10s for running QEMU VMs
  // Pauses when the browser tab is hidden (Page Visibility API)
  useEffect(() => {
    if (!isRunning || !isQemu) {
      setScreenshotUrl(null)
      setScreenshotFailed(false)
      return
    }

    function start() {
      if (intervalRef.current) return
      fetchScreenshot()
      intervalRef.current = setInterval(fetchScreenshot, 10_000)
    }

    function stop() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    function onVisChange() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    document.addEventListener('visibilitychange', onVisChange)
    if (document.visibilityState === 'visible') start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [fetchScreenshot, isRunning, isQemu])

  // Reset screenshot when VM changes. The cleanup also runs on unmount, so the
  // last blob URL is always revoked rather than leaked.
  useEffect(() => {
    setScreenshotUrl(null)
    setScreenshotFailed(false)
    setNoDisplay(false)
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [vmid, connId])

  // Determine OS icon
  const getOsIconData = () => {
    if (!osInfo?.name && !osInfo?.type) return null

    const osName = osInfo?.name || ''
    const osType = osInfo?.type

    const svgIcon = getOsSvgIcon(osName, osType)
    if (svgIcon) return { type: 'svg' as const, src: svgIcon }

    if (osName.toLowerCase().includes('mac') || osName.toLowerCase().includes('darwin')) {
      return { type: 'ri' as const, className: 'ri-apple-fill' }
    }

    return { type: 'ri' as const, className: 'ri-computer-fill' }
  }

  const osIconData = getOsIconData()

  const consoleBtnSx = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5,
    px: 1.5, py: 1, minWidth: 64, color: 'white', cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.3)', borderRadius: 'var(--proxcenter-card-radius, 8px)',
    background: 'rgba(255,255,255,0.08)', font: 'inherit', fontSize: '0.75rem',
    '&:hover': { background: 'rgba(255,255,255,0.18)', borderColor: 'primary.main' },
  } as const

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Box
        onClick={isRunning ? handleOpenConsole : undefined}
        sx={{
          width: '100%',
          height,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
          bgcolor: '#0b1220',
          position: 'relative',
          cursor: isRunning && base ? 'pointer' : 'default',
          transition: 'all 0.2s ease',
          '&:hover': isRunning && base ? {
            borderColor: 'primary.main',
            boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.3)',
          } : {},
        }}
      >
        {/* Live screenshot for running QEMU VMs */}
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt="VM screen"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              zIndex: 1,
            }}
          />
        )}

        {/* OS icon watermark */}
        {osIconData && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            {osIconData.type === 'svg' ? (
              <img src={osIconData.src} alt="" width={100} height={100} style={{ opacity: 0.12, filter: 'brightness(0) invert(1)' }} />
            ) : (
              <Box
                component="i"
                className={osIconData.className}
                sx={{
                  fontSize: 100,
                  color: 'rgba(255, 255, 255, 0.12)',
                }}
              />
            )}
          </Box>
        )}

        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(255,255,255,0.65)',
            px: 2,
            textAlign: 'center',
            zIndex: screenshotUrl ? 0 : 2,
          }}
        >
          {isRunning ? (
            <Box>
              {noDisplay ? (
                /* Serial-only / headless VM: no graphical screen to preview */
                <Box>
                  <Box
                    component="i"
                    className="ri-terminal-box-line"
                    sx={{ fontSize: 40, color: 'rgba(255,255,255,0.3)', mb: 1, display: 'block' }}
                  />
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                    {t('console.serialConsole')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
                    {t('console.noGraphicalPreview')}
                  </Typography>
                </Box>
              ) : (
                /* Loading spinner until the first screenshot lands */
                !screenshotUrl && !screenshotFailed && isQemu && (
                  <CircularProgress size={20} sx={{ color: 'rgba(255,255,255,0.3)' }} />
                )
              )}
            </Box>
          ) : (
            <Box>
              <Box
                component="i"
                className="ri-shut-down-line"
                sx={{ fontSize: 40, color: 'rgba(255,255,255,0.25)', mb: 1, display: 'block' }}
              />
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                {t('common.offline')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.35)' }}>
                {t('audit.actions.start')}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Console-type picker overlay (on hover, running guests) */}
        {isRunning && base && (
          <Box
            sx={{
              position: 'absolute', inset: 0, zIndex: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
              opacity: 0, transition: 'opacity 0.2s ease', bgcolor: 'rgba(0,0,0,0.55)',
              '&:hover': { opacity: 1 },
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <MuiTooltip title="noVNC">
              <Box component="button" onClick={() => openConsole('novnc')} sx={consoleBtnSx}>
                <i className="ri-computer-line" style={{ fontSize: 18 }} />
                <span>noVNC</span>
              </Box>
            </MuiTooltip>
            {isQemu && spiceCapable !== false && (
              <MuiTooltip title="SPICE">
                <Box component="button" onClick={() => openConsole('spice')} sx={consoleBtnSx}>
                  <i className="ri-remote-control-line" style={{ fontSize: 18 }} />
                  <span>SPICE</span>
                </Box>
              </MuiTooltip>
            )}
          </Box>
        )}

        {/* OS Info overlay (bottom-left) */}
        {(osInfo || osLoading) && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 3,
              px: 1.5,
              py: 0.75,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            {osLoading ? (
              <>
                <CircularProgress size={10} sx={{ color: 'rgba(255,255,255,0.5)' }} />
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>{t('common.loading')}</Typography>
              </>
            ) : osInfo ? (
              <MuiTooltip
                title={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{osInfo.name || 'Unknown OS'}</Typography>
                    {osInfo.version && <Typography variant="caption" sx={{ display: 'block' }}>Version: {osInfo.version}</Typography>}
                    {osInfo.kernel && <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>Kernel: {osInfo.kernel}</Typography>}
                  </Box>
                }
                arrow
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pointerEvents: 'auto' }}>
                  {osIconData?.type === 'svg'
                    ? <img src={osIconData.src} alt="" width={14} height={14} style={{ opacity: 0.9 }} />
                    : <i className={osIconData?.className || 'ri-terminal-box-line'} style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }} />
                  }
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                    {osInfo.name || 'Unknown'}
                  </Typography>
                </Box>
              </MuiTooltip>
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default ConsolePreview
