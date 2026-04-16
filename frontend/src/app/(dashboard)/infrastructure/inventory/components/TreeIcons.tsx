'use client'

import React from 'react'

import { Box, CircularProgress, useTheme } from '@mui/material'

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Retourne l'icône appropriée pour une VM (template ou non)
export function getVmIcon(type: string, isTemplate?: boolean, filled = true): string {
  if (isTemplate) {
    return filled ? 'ri-file-copy-fill' : 'ri-file-copy-line'
  }

  if (type === 'lxc') {
    return filled ? 'ri-instance-fill' : 'ri-instance-line'
  }

  return filled ? 'ri-computer-fill' : 'ri-computer-line'
}

/* ------------------------------------------------------------------ */
/* Status Icon Component                                              */
/* ------------------------------------------------------------------ */

export function StatusIcon({ status, type, isMigrating, isPendingAction, maintenance, template, vmType, size: propSize, lock }: { status?: string; type: 'node' | 'vm'; isMigrating?: boolean; isPendingAction?: boolean; maintenance?: string; template?: boolean; vmType?: string; size?: number; lock?: string }) {
  if (type === 'node') {
    return null // Use NodeIcon instead for nodes
  }

  // VM icon with status dot badge
  const iconClass = getVmIcon(vmType || 'qemu', template)
  const size = propSize || 16
  const dotSize = Math.round(size * 0.5)

  // Pending action: spinner instead of dot
  if (isPendingAction) {
    return (
      <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
        <i className={iconClass} style={{ fontSize: size, opacity: 0.7 }} />
        <Box sx={{ position: 'absolute', bottom: -2, right: -3 }}>
          <CircularProgress size={dotSize} thickness={6} sx={{ color: '#ff9800' }} />
        </Box>
      </Box>
    )
  }

  // Migrating: pulsing orange dot
  if (isMigrating) {
    return (
      <Box component="span" sx={{
        position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0,
        '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
        animation: 'pulse 1.5s ease-in-out infinite',
      }}>
        <i className={iconClass} style={{ fontSize: size, opacity: 0.7 }} />
        <Box sx={{ position: 'absolute', bottom: -2, right: -3, width: dotSize, height: dotSize, borderRadius: '50%', bgcolor: '#ff9800', border: '1.5px solid', borderColor: 'background.paper' }} />
      </Box>
    )
  }

  // Template: no dot
  if (template) {
    return (
      <Box component="span" sx={{ display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
        <i className={iconClass} style={{ fontSize: size, opacity: 0.5 }} />
      </Box>
    )
  }

  // Normal VM: icon + colored status dot
  const dotColor = status === 'running' ? '#4caf50' : status === 'paused' ? '#ed6c02' : '#f44336'

  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <i className={iconClass} style={{ fontSize: size, opacity: 0.7 }} />
      <Box sx={{
        position: 'absolute', bottom: -2, right: -3,
        width: dotSize, height: dotSize, borderRadius: '50%',
        bgcolor: dotColor,
        border: '1.5px solid', borderColor: 'background.paper',
        boxShadow: status === 'running' ? `0 0 4px ${dotColor}` : 'none',
      }} />
      {lock && (
        <Box sx={{
          position: 'absolute', top: -3, left: -3,
          width: dotSize, height: dotSize, borderRadius: '50%',
          bgcolor: '#ff9800',
          border: '1.5px solid', borderColor: 'background.paper',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <i className="ri-lock-fill" style={{ fontSize: dotSize - 2, color: '#fff' }} />
        </Box>
      )}
    </Box>
  )
}

export function NodeIcon({ status, maintenance, size = 16 }: { status?: string; maintenance?: string; size?: number }) {
  const theme = useTheme()
  const dotSize = Math.round(size * 0.5)
  const logoSrc = theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'

  let dotColor = status === 'online' ? '#4caf50' : '#f44336'
  let dotIcon = null as React.ReactNode

  if (maintenance) {
    dotColor = '#ff9800'
    dotIcon = <i className="ri-tools-fill" style={{ fontSize: dotSize - 2, color: '#fff' }} />
  }

  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flexShrink: 0 }}>
      <img
        src={logoSrc}
        alt=""
        style={{
          width: size,
          height: size,
          opacity: status === 'online' || maintenance ? 0.8 : 0.4,
          filter: maintenance ? 'hue-rotate(-30deg) saturate(2)' : undefined,
        }}
      />
      <Box sx={{
        position: 'absolute', bottom: -2, right: -2,
        width: dotSize, height: dotSize, borderRadius: '50%',
        bgcolor: dotColor,
        border: '1.5px solid', borderColor: 'background.paper',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {dotIcon}
      </Box>
    </Box>
  )
}

export function ClusterIcon({ nodes, size = 14 }: { nodes: { status?: string }[]; size?: number }) {
  const dotSize = Math.round(size * 0.5)
  const allOnline = nodes.length > 0 && nodes.every(n => n.status === 'online')
  const dotColor = allOnline ? '#4caf50' : '#ff9800'

  return (
    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, flexShrink: 0 }}>
      <i className="ri-server-fill" style={{ opacity: 0.8, fontSize: size }} />
      <Box sx={{
        position: 'absolute', bottom: -2, right: -2,
        width: dotSize, height: dotSize, borderRadius: '50%',
        bgcolor: dotColor,
        border: '1.5px solid', borderColor: 'background.paper',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }} />
    </Box>
  )
}
