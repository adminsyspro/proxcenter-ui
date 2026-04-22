'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Button } from '@mui/material'

// Component Imports
import Navigation from './Navigation'
import NavbarContent from './NavbarContent'
import BurgerMenu from './BurgerMenu'
import Navbar from '@layouts/components/horizontal/Navbar'
import LayoutHeader from '@layouts/components/horizontal/Header'
import Logo from '@components/layout/shared/Logo'
import NFRBadge from '@components/license/NFRBadge'

// Hook Imports
import useHorizontalNav from '@menu/hooks/useHorizontalNav'

const Header = () => {
  const { isBreakpointReached } = useHorizontalNav()
  const router = useRouter()

  // Burger menu state
  const [burgerAnchor, setBurgerAnchor] = useState(null)

  return (
    <>
      <LayoutHeader>
        <Navbar>
          {/* Logo + burger on the left */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                color: 'text.primary'
              }}
              onClick={() => router.push('/home')}
            >
              <Logo />
            </Box>
            <Button
              size='small'
              onClick={(e) => setBurgerAnchor(e.currentTarget)}
              sx={{
                minWidth: 'auto',
                p: 0.75,
                borderRadius: 1,
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: 'action.hover',
                  color: 'text.primary'
                }
              }}
            >
              <i className='ri-menu-line' style={{ fontSize: 20 }} />
            </Button>
            <NFRBadge />
          </Box>

          {/* NavbarContent (search, icons, profile, etc.) */}
          <NavbarContent />
        </Navbar>
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
