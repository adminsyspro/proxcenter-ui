'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Button, Typography } from '@mui/material'
import { useTheme, useColorScheme } from '@mui/material/styles'

// Component Imports
import Navigation from './Navigation'
import NavbarContent from './NavbarContent'
import BurgerMenu from './BurgerMenu'
import Navbar from '@layouts/components/horizontal/Navbar'
import LayoutHeader from '@layouts/components/horizontal/Header'
import VCenterHeader from '@components/layout/vcenter/VCenterHeader'
import { LogoIcon } from '@components/layout/shared/Logo'

// Hook Imports
import useHorizontalNav from '@menu/hooks/useHorizontalNav'
import { useSettings } from '@core/hooks/useSettings'

/**
 * Build a CSS string that sets all dark-scheme CSS custom properties
 * directly on the <header> element. This makes every child MUI component
 * (which resolves sx tokens to var(--mui-palette-*)) render in dark mode
 * even though the page itself is in light mode.
 */
const buildDarkOverrideCSS = (theme) => {
  const sheets = theme.generateStyleSheets?.()
  if (!sheets) return ''

  // Find the [data-dark] sheet (contains all dark CSS custom properties)
  const darkSheet = sheets.find(s => s['[data-dark]'])
  if (!darkSheet) return ''

  const darkCSS = darkSheet['[data-dark]']

  const lines = Object.entries(darkCSS)
    .filter(([k]) => k.startsWith('--'))
    .map(([k, v]) => `${k}: ${v};`)

  // Also override Tailwind's --border-color used by border-bs, etc.
  lines.push(`--border-color: ${darkCSS['--mui-palette-divider'] || 'rgba(231,227,252,0.12)'};`)
  lines.push('color-scheme: dark;')

  return lines.join('\n')
}

const Header = () => {
  // Hooks
  const { isBreakpointReached } = useHorizontalNav()
  const { settings } = useSettings()
  const router = useRouter()
  const theme = useTheme()
  const { mode, systemMode } = useColorScheme()

  // Burger menu state
  const [burgerAnchor, setBurgerAnchor] = useState(null)

  const currentMode = mode === 'system' ? systemMode : mode
  const isDark = currentMode === 'dark'

  // In light mode, force the header to use dark-scheme CSS variables
  // so it renders identically to the dark theme.
  const darkOverrideStyles = useMemo(() => {
    if (isDark) return undefined
    return buildDarkOverrideCSS(theme)
  }, [isDark, theme])

  // vCenter theme: render dedicated header instead of standard horizontal layout
  if (settings.globalTheme === 'vcenter') {
    return <VCenterHeader />
  }

  const accentColor = theme.palette.primary.main

  return (
    <>
      <LayoutHeader overrideStyles={darkOverrideStyles}>
        <Navbar>
          {/* Logo + Burger on the left */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2 }}>
            {/* Logo */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                mr: 0.5,
                color: 'text.primary'
              }}
              onClick={() => router.push('/home')}
            >
              <LogoIcon size={26} accentColor={accentColor} />
              <Typography
                sx={{
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  display: { xs: 'none', sm: 'block' }
                }}
              >
                ProxCenter
              </Typography>
            </Box>

            {/* Burger button */}
            <Button
              size='small'
              onClick={(e) => setBurgerAnchor(e.currentTarget)}
              sx={{
                textTransform: 'none',
                fontSize: 12,
                fontWeight: 500,
                minWidth: 'auto',
                px: 1,
                py: 0.5,
                borderRadius: 1,
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                  color: 'text.primary'
                }
              }}
            >
              <i className='ri-menu-line' style={{ fontSize: 18, marginRight: 4 }} />
              <Box component='span' sx={{ display: { xs: 'none', sm: 'inline' } }}>Menu</Box>
            </Button>
          </Box>

          {/* NavbarContent (search, icons, profile, etc.) */}
          <NavbarContent />
        </Navbar>
        {!isBreakpointReached && <Navigation />}
      </LayoutHeader>
      {isBreakpointReached && <Navigation />}

      {/* Burger Menu Popover */}
      <BurgerMenu
        anchorEl={burgerAnchor}
        open={Boolean(burgerAnchor)}
        onClose={() => setBurgerAnchor(null)}
      />
    </>
  )
}

export default Header
