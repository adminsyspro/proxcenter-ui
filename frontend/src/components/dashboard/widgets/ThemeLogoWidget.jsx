'use client'

import React from 'react'

import { Box, useTheme } from '@mui/material'

import primaryColorConfig from '@configs/primaryColorConfig'
import themeConfig from '@configs/themeConfig'
import { useSettings } from '@core/hooks/useSettings'
import { useBranding } from '@/contexts/BrandingContext'
import { LogoIcon } from '@components/layout/shared/Logo'
import { themeNames } from '@components/layout/shared/ThemeDropdown'

// Shows only the logo of the active theme, with the same visuals as the
// navbar ThemeDropdown: custom branding logo first, then the ProxCenter logo
// for the default theme, then the theme's colored badge.
function ThemeLogoWidget() {
  const theme = useTheme()
  const { settings } = useSettings()
  const { branding } = useBranding()
  const isDark = theme.palette.mode === 'dark'

  const currentTheme = primaryColorConfig.find(c => c.main === settings.primaryColor) || primaryColorConfig[0]
  const themeInfo = themeNames[currentTheme.name] || { name: currentTheme.name, icon: 'ri-palette-fill' }
  const isProxcenterLogo = !branding.logoUrl && themeInfo.icon === 'proxmox-logo'

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 'var(--proxcenter-card-radius)', p: 1.5, height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {branding.logoUrl ? (
        <Box
          component='img'
          src={branding.logoUrl}
          alt={branding.appName || themeConfig.templateName}
          sx={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
        />
      ) : isProxcenterLogo ? (
        <Box sx={{ display: 'flex', alignItems: 'center', color: isDark ? '#e0e0e0' : '#333' }}>
          <LogoIcon size={52} accentColor={currentTheme.main} />
        </Box>
      ) : (
        <Box
          sx={{
            width: '3.2em', height: '3.2em', borderRadius: '50%',
            bgcolor: currentTheme.main, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Box component='i' className={themeInfo.icon} sx={{ fontSize: '1.5em', color: '#fff', lineHeight: 1 }} />
        </Box>
      )}
    </Box>
  )
}

export default React.memo(ThemeLogoWidget)
