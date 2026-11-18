// React Imports
import { useRef } from 'react'

// Next Imports
import Link from 'next/link'

// MUI Imports
import { styled } from '@mui/material/styles'

// Third-party Imports
import PerfectScrollbar from 'react-perfect-scrollbar'

// Component Imports
import NavHeader from '@menu/components/vertical-menu/NavHeader'
import Logo from '@components/layout/shared/Logo'
import NavCollapseIcons from '@menu/components/vertical-menu/NavCollapseIcons'

// Hook Imports
import useHorizontalNav from '@menu/hooks/useHorizontalNav'

// Util Imports
import { mapHorizontalToVerticalMenu } from '@menu/utils/menuUtils'

// Type Imports
import type { ReactNode, UIEvent } from 'react'

import { scrollContainerOf } from '@components/layout/shared/scrollSource'
import type { ScrollSource } from '@components/layout/shared/scrollSource'

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

const VerticalNavContent = ({ children }: { children: ReactNode }) => {
  // Hooks
  const { isBreakpointReached } = useHorizontalNav()

  // Refs
  const shadowRef = useRef<HTMLDivElement>(null)

  // Vars
  const ScrollWrapper = isBreakpointReached ? 'div' : PerfectScrollbar

  const scrollMenu = (source: ScrollSource) => {
    const container = scrollContainerOf(source)

    if (container && container.scrollTop > 0) {
      shadowRef.current?.classList.add('scrolled')
    } else {
      shadowRef.current?.classList.remove('scrolled')
    }
  }

  return (
    <>
      <NavHeader>
        <Link href='/'>
          <Logo />
        </Link>
        <NavCollapseIcons
          lockedIcon={<i className='ri-radio-button-line text-xl' />}
          unlockedIcon={<i className='ri-checkbox-blank-circle-line text-xl' />}
          closeIcon={<i className='ri-close-line text-xl' />}
          className='text-textSecondary'
        />
      </NavHeader>
      <StyledBoxForShadow ref={shadowRef} />
      <ScrollWrapper
        {...(isBreakpointReached
          ? {
              className: 'bs-full overflow-y-auto overflow-x-hidden',
              onScroll: (event: UIEvent<HTMLElement>) => scrollMenu(event)
            }
          : {
              options: { wheelPropagation: false, suppressScrollX: true },
              onScrollY: (container: HTMLElement) => scrollMenu(container)
            })}
      >
        {mapHorizontalToVerticalMenu(children)}
      </ScrollWrapper>
    </>
  )
}

export default VerticalNavContent
