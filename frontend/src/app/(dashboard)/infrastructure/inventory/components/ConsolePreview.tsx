'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

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
  
  // URL de la page console fullscreen (noVNC)
  const consoleUrl = connId && node && type && vmid 
    ? `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`
    : null

  const handleOpenConsole = () => {
    if (consoleUrl) {
      window.open(
        consoleUrl, 
        `console-${vmid}`,
        'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
      )
    }
  }

  // Déterminer l'icône Remix Icon à afficher selon l'OS
  const getOsIcon = () => {
    if (!osInfo?.name && !osInfo?.type) return null
    
    const osName = (osInfo?.name || '').toLowerCase()
    const osType = osInfo?.type
    
    // Windows
    if (osType === 'windows' || osName.includes('windows')) {
      return 'ri-windows-fill'
    }
    // Ubuntu
    if (osName.includes('ubuntu')) {
      return 'ri-ubuntu-fill'
    }
    // Debian, Linux générique et autres distributions
    if (osType === 'linux' || osName.includes('linux') || osName.includes('debian') || 
        osName.includes('centos') || osName.includes('fedora') || osName.includes('arch') ||
        osName.includes('alpine') || osName.includes('suse') || osName.includes('red hat') ||
        osName.includes('rhel')) {
      return 'ri-ubuntu-fill' // Utiliser ubuntu comme icône Linux générique
    }
    // macOS
    if (osName.includes('mac') || osName.includes('darwin')) {
      return 'ri-apple-fill'
    }
    // FreeBSD et autres
    if (osName.includes('bsd')) {
      return 'ri-terminal-box-fill'
    }
    
    return 'ri-computer-fill'
  }

  const osIcon = getOsIcon()

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
        {/* Icône OS en fond */}
        {osIcon && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Box
              component="i"
              className={osIcon}
              sx={{
                fontSize: 100,
                color: 'rgba(255, 255, 255, 0.12)',
              }}
            />
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
          }}
        >
          {isRunning ? (
            <Box>
              {/* Zone cliquable vide - juste l'icône OS en fond suffit */}
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
      </Box>

      {/* OS Info en dessous de la console */}
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
              <i 
                className={osInfo.type === 'windows' ? 'ri-windows-fill' : osInfo.type === 'linux' ? 'ri-ubuntu-fill' : 'ri-terminal-box-line'} 
                style={{ 
                  fontSize: 12, 
                  color: osInfo.type === 'windows' ? '#0078D4' : osInfo.type === 'linux' ? '#E95420' : undefined 
                }} 
              />
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
