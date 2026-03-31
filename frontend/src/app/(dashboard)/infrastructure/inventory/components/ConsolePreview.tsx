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

/**
 * Decode a base64-encoded PPM (P6 binary) image and draw it onto a canvas.
 * Returns a data URL (JPEG) or null on failure.
 */
function decodePpmToDataUrl(b64Data: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const binary = atob(b64Data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      // Parse PPM P6 header: "P6\n<width> <height>\n<maxval>\n"
      let offset = 0
      const readLine = (): string => {
        let line = ''
        while (offset < bytes.length) {
          const ch = bytes[offset++]
          if (ch === 10) break // \n
          line += String.fromCharCode(ch)
        }
        // Skip comment lines
        if (line.startsWith('#')) return readLine()
        return line.trim()
      }

      const magic = readLine()
      if (magic !== 'P6') { resolve(null); return }

      // Width and height might be on one line or two
      let dims = readLine()
      const parts = dims.split(/\s+/)
      let width: number, height: number
      if (parts.length >= 2) {
        width = parseInt(parts[0])
        height = parseInt(parts[1])
      } else {
        width = parseInt(parts[0])
        height = parseInt(readLine())
      }

      const maxVal = parseInt(readLine())
      if (!width || !height || !maxVal) { resolve(null); return }

      // Create canvas and draw pixel data
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(null); return }

      const imageData = ctx.createImageData(width, height)
      const data = imageData.data
      const pixelBytes = maxVal > 255 ? 6 : 3

      for (let i = 0; i < width * height; i++) {
        const srcIdx = offset + i * pixelBytes
        if (pixelBytes === 3) {
          data[i * 4] = bytes[srcIdx]       // R
          data[i * 4 + 1] = bytes[srcIdx + 1] // G
          data[i * 4 + 2] = bytes[srcIdx + 2] // B
        } else {
          // 16-bit: take high byte
          data[i * 4] = bytes[srcIdx]
          data[i * 4 + 1] = bytes[srcIdx + 2]
          data[i * 4 + 2] = bytes[srcIdx + 4]
        }
        data[i * 4 + 3] = 255 // A
      }

      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    } catch {
      resolve(null)
    }
  })
}

function ConsolePreview({
  height = 210,
  connId,
  node,
  type,
  vmid,
  vmStatus,
  osInfo,
  osLoading
}: {
  height?: number
  connId?: string
  node?: string
  type?: string
  vmid?: string
  vmStatus?: string
  osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null
  osLoading?: boolean
}) {
  const t = useTranslations()
  const isRunning = vmStatus?.toLowerCase() === 'running'
  const isQemu = type === 'qemu'
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotFailed, setScreenshotFailed] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // URL de la page console fullscreen (noVNC)
  const consoleUrl = connId && node && type && vmid
    ? `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`
    : null

  const fetchScreenshot = useCallback(async () => {
    if (!connId || !node || !type || !vmid || !isRunning || !isQemu) return

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${encodeURIComponent(type)}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/screenshot`
      )
      const json = await res.json()

      if (json.data) {
        const dataUrl = await decodePpmToDataUrl(json.data)
        if (dataUrl) {
          setScreenshotUrl(dataUrl)
          setScreenshotFailed(false)
          return
        }
      }
      // No data or decode failed - keep existing screenshot if any, mark as failed for fresh attempts
      setScreenshotFailed(true)
    } catch {
      setScreenshotFailed(true)
    }
  }, [connId, node, type, vmid, isRunning, isQemu])

  // Fetch screenshot on mount and every 10s for running QEMU VMs
  useEffect(() => {
    if (!isRunning || !isQemu) {
      setScreenshotUrl(null)
      setScreenshotFailed(false)
      return
    }

    fetchScreenshot()
    intervalRef.current = setInterval(fetchScreenshot, 10_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchScreenshot, isRunning, isQemu])

  // Reset screenshot when VM changes
  useEffect(() => {
    setScreenshotUrl(null)
    setScreenshotFailed(false)
  }, [vmid, connId])

  const handleOpenConsole = () => {
    if (consoleUrl) {
      window.open(
        consoleUrl,
        `console-${vmid}`,
        'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
      )
    }
  }

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

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 900, opacity: 0.9 }}>
          Console
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isRunning && consoleUrl && (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              noVNC
            </Typography>
          )}
        </Box>
      </Box>

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
          cursor: isRunning && consoleUrl ? 'pointer' : 'default',
          transition: 'all 0.2s ease',
          '&:hover': isRunning && consoleUrl ? {
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
              {/* Click to open console overlay - only visible when no screenshot */}
              {!screenshotUrl && !screenshotFailed && isQemu && (
                <CircularProgress size={20} sx={{ color: 'rgba(255,255,255,0.3)' }} />
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

        {/* "Click to open" overlay on hover when screenshot is shown */}
        {screenshotUrl && isRunning && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0,
              transition: 'opacity 0.2s ease',
              bgcolor: 'rgba(0,0,0,0.5)',
              '&:hover': { opacity: 1 },
            }}
          >
            <Box sx={{ textAlign: 'center', color: 'white' }}>
              <i className="ri-fullscreen-line" style={{ fontSize: 28 }} />
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                Console
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* OS Info below console */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 0.5, mt: 0.5 }}>
        {osLoading ? (
          <>
            <CircularProgress size={10} />
            <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('common.loading')}</Typography>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <i className="ri-computer-line" style={{ fontSize: 12, opacity: 0.5 }} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>OS:</Typography>
              {osIconData?.type === 'svg'
                ? <img src={osIconData.src} alt="" width={12} height={12} />
                : <i
                    className={osIconData?.className || 'ri-terminal-box-line'}
                    style={{ fontSize: 12 }}
                  />
              }
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {osInfo.name || 'Unknown'}
              </Typography>
            </Box>
          </MuiTooltip>
        ) : null}
      </Box>
    </Box>
  )
}

export default ConsolePreview
