'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Button, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'

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

const Header = () => {
  // Hooks
  const { isBreakpointReached } = useHorizontalNav()
  const { settings } = useSettings()
  const router = useRouter()
  const theme = useTheme()

  // Burger menu state
  const [burgerAnchor, setBurgerAnchor] = useState(null)

  // vCenter theme: render dedicated header instead of standard horizontal layout
  if (settings.globalTheme === 'vcenter') {
    return <VCenterHeader />
  }

  const accentColor = theme.palette.primary.main
  const isDark = theme.palette.mode === 'dark'

  // Dark header bar styling — always dark background, even in light theme
  const darkHeaderOverrides = !isDark ? `
    background-color: #2f3349 !important;
    color: #fff !important;
    & .MuiTypography-root { color: inherit !important; }
    & .MuiIconButton-root { color: rgba(255,255,255,0.85) !important; }
    & .MuiIconButton-root:hover { background-color: rgba(255,255,255,0.08) !important; }
    & .MuiAvatar-root { color: #fff !important; }
    & .ri-search-line, & .ri-menu-line { color: inherit !important; }
  ` : ''

  return (
    <>
      <LayoutHeader overrideStyles={darkHeaderOverrides}>
        <Navbar>
          {/* Logo + Burger on the left */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, color: !isDark ? '#fff' : 'inherit' }}>
            {/* Logo */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                mr: 0.5,
                color: !isDark ? '#fff' : 'text.primary'
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
                  display: { xs: 'none', sm: 'block' },
                  color: 'inherit'
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
                color: !isDark ? 'rgba(255,255,255,0.75)' : 'text.secondary',
                '&:hover': {
                  bgcolor: !isDark ? 'rgba(255,255,255,0.08)' : 'action.hover',
                  color: !isDark ? '#fff' : 'text.primary'
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
