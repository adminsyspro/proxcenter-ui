'use client'

// React Imports
import { useEffect, useRef, useState } from 'react'

// Next Imports
import Link from 'next/link'

// MUI Imports
import { styled, useColorScheme, useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'

// Component Imports
import VerticalNav, { NavHeader, NavCollapseIcons } from '@menu/vertical-menu'
import VerticalMenu from './VerticalMenu'
import Logo from '@components/layout/shared/Logo'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'
import { useSettings } from '@core/hooks/useSettings'

// Style Imports
import navigationCustomStyles from '@core/styles/vertical/navigationCustomStyles'

const StyledBoxForShadow = styled('div')(({ theme }) => ({
  top: 60,
  left: -8,
  zIndex: 2,
  opacity: 0,
  position: 'absolute',
  pointerEvents: 'none',
  width: 'calc(100% + 15px)',
  height: theme.mixins.toolbar.minHeight,
  transition: 'opacity .15s ease-in-out',
  background: `linear-gradient(var(--mui-palette-background-default) ${theme.direction === 'rtl' ? '95%' : '5%'}, color-mix(in srgb, var(--mui-palette-background-default) 85%, transparent) 30%, color-mix(in srgb, var(--mui-palette-background-default) 50%, transparent) 65%, color-mix(in srgb, var(--mui-palette-background-default) 30%, transparent) 75%, transparent)`,
}))

// Zone de déclenchement pour faire réapparaître la sidebar
const HoverTriggerZone = styled('div')({
  position: 'fixed',
  left: 0,
  top: 0,
  width: 12,
  height: '100vh',
  zIndex: 1300,
  cursor: 'pointer',
})

const Navigation = props => {
  // Props
  const { mode } = props

  // Hooks
  const verticalNavOptions = useVerticalNav()
  const { updateSettings, settings } = useSettings()
  const { mode: muiMode, systemMode: muiSystemMode } = useColorScheme()
  const theme = useTheme()

  // Refs
  const shadowRef = useRef(null)
  const hoverTimeoutRef = useRef(null)

  // State pour le mode hidden hover
  const [isHiddenHovered, setIsHiddenHovered] = useState(false)

  // Vars
  const { isCollapsed, isHovered, collapseVerticalNav, isBreakpointReached } = verticalNavOptions
  const isSemiDark = settings.semiDark
  const currentMode = muiMode === 'system' ? muiSystemMode : muiMode || mode
  const isDark = currentMode === 'dark'
  const isHidden = settings.layout === 'hidden'

  const scrollMenu = (container, isPerfectScrollbar) => {
    container = isBreakpointReached || !isPerfectScrollbar ? container.target : container

    if (shadowRef && container.scrollTop > 0) {
      if (!shadowRef.current?.classList.contains('scrolled')) {
        shadowRef.current?.classList.add('scrolled')
      }
    } else {
      shadowRef.current?.classList.remove('scrolled')
    }
  }

  useEffect(() => {
    if (settings.layout === 'collapsed') {
      collapseVerticalNav(true)
    } else if (settings.layout === 'hidden') {
      collapseVerticalNav(true)
    } else {
      collapseVerticalNav(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.layout])

  // Quand on entre en mode hidden+hovered, on force le menu à être déplié
  useEffect(() => {
    if (isHidden && isHiddenHovered) {
      collapseVerticalNav(false)
    } else if (isHidden && !isHiddenHovered) {
      collapseVerticalNav(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHiddenHovered, isHidden])

  // Gestion du hover sur la zone de déclenchement
  const handleTriggerMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setIsHiddenHovered(true)
  }

  const handleNavMouseLeave = () => {
    if (isHidden) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHiddenHovered(false)
      }, 300)
    }
  }

  const handleNavMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
  }

  // Cycle des modes: vertical -> collapsed -> hidden -> vertical
  const cycleLayout = () => {
    if (settings.layout === 'vertical') {
      updateSettings({ layout: 'collapsed' })
    } else if (settings.layout === 'collapsed') {
      updateSettings({ layout: 'hidden' })
    } else {
      updateSettings({ layout: 'vertical' })
      setIsHiddenHovered(false)
    }
  }

  // Si mode hidden et pas survolé, afficher seulement la zone de déclenchement
  if (isHidden && !isHiddenHovered) {
    return (
      <HoverTriggerZone 
        onMouseEnter={handleTriggerMouseEnter}
        sx={{
          '&::after': {
            content: '""',
            position: 'absolute',
            left: 3,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 4,
            height: 48,
            borderRadius: 2,
            bgcolor: 'divider',
            opacity: 0.3,
            transition: 'all 0.2s',
          },
          '&:hover::after': {
            opacity: 1,
            bgcolor: 'primary.main',
            height: 64,
          }
        }}
      />
    )
  }

  // Si mode hidden et survolé, afficher le menu déplié en overlay fixe
  if (isHidden && isHiddenHovered) {
    return (
      <Box
        onMouseEnter={handleNavMouseEnter}
        onMouseLeave={handleNavMouseLeave}
        sx={{
          position: 'fixed',
          left: 0,
          top: 0,
          height: '100vh',
          zIndex: 1300,
          boxShadow: '4px 0 24px rgba(0,0,0,0.25)',
        }}
      >
        <VerticalNav
          customStyles={navigationCustomStyles(verticalNavOptions, theme)}
          collapsedWidth={68}
          backgroundColor='var(--mui-palette-background-default)'
          {...(isSemiDark && !isDark && { 'data-dark': '' })}
        >
          <NavHeader>
            <Link href='/'>
              <Logo />
            </Link>
            <NavCollapseIcons
              lockedIcon={<i className='ri-radio-button-line text-xl' />}
              unlockedIcon={<i className='ri-checkbox-blank-circle-line text-xl' />}
              closeIcon={<i className='ri-close-line text-xl' />}
              className='text-textSecondary'
              onClick={cycleLayout}
            />
          </NavHeader>
          <StyledBoxForShadow ref={shadowRef} />
          <VerticalMenu scrollMenu={scrollMenu} />
        </VerticalNav>
      </Box>
    )
  }

  // Mode normal (vertical ou collapsed)
  return (
    <VerticalNav
      customStyles={navigationCustomStyles(verticalNavOptions, theme)}
      collapsedWidth={68}
      backgroundColor='var(--mui-palette-background-default)'
      {...(isSemiDark &&
        !isDark && {
          'data-dark': ''
        })}
    >
      {/* Nav Header including Logo & nav toggle icons  */}
      <NavHeader>
        <Link href='/'>
          <Logo />
        </Link>
        {!(isCollapsed && !isHovered) && (
          <NavCollapseIcons
            lockedIcon={<i className='ri-radio-button-line text-xl' />}
            unlockedIcon={<i className='ri-checkbox-blank-circle-line text-xl' />}
            closeIcon={<i className='ri-close-line text-xl' />}
            className='text-textSecondary'
            onClick={cycleLayout}
          />
        )}
      </NavHeader>
      <StyledBoxForShadow ref={shadowRef} />
      <VerticalMenu scrollMenu={scrollMenu} />
    </VerticalNav>
  )
}

export default Navigation
