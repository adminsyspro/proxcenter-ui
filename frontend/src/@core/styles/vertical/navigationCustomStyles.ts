// Util Imports
import { menuClasses, verticalNavClasses } from '@menu/utils/menuClasses'

// Type Imports
import type { CSSObject } from '@emotion/react'
import type { Theme } from '@mui/material/styles'

import type { VerticalNavState } from '@menu/types'

const navigationCustomStyles = (verticalNavOptions: VerticalNavState, theme: Theme): CSSObject => {
  // Vars
  const { isCollapsed, isHovered, collapsedWidth = 0, transitionDuration } = verticalNavOptions
  const collapsedHovered = isCollapsed && isHovered
  const collapsedNotHovered = isCollapsed && !isHovered

  return {
    color: 'var(--mui-palette-text-primary)',
    zIndex: 'var(--drawer-z-index) !important',
    [`& .${verticalNavClasses.header}`]: {
      paddingBlock: theme.spacing(5),
      paddingInline: theme.spacing(5.5, 4),
      ...(collapsedNotHovered && {
        paddingInline: theme.spacing((collapsedWidth - 29) / 8),
        '& a': {
          transform: `translateX(-${22 - (collapsedWidth - 29) / 2}px)`
        }
      }),
      '& a': {
        transition: `transform ${transitionDuration}ms ease`
      }
    },
    [`& .${verticalNavClasses.container}`]: {
      transition: theme.transitions.create(['inline-size', 'inset-inline-start', 'box-shadow'], {
        duration: transitionDuration,
        easing: 'ease-in-out'
      }),
      borderColor: 'transparent',
      ...(collapsedHovered && {
        boxShadow: 'var(--mui-customShadows-lg)'
      }),
      [`& .${verticalNavClasses.toggled}`]: {
        boxShadow: 'var(--mui-customShadows-lg)'
      },
      '[data-skin="bordered"] &': {
        borderColor: 'var(--mui-palette-divider)'
      }
    },
    [`& .${menuClasses.root}`]: {
      // Items run to the nav edge, and the first one lines up with the top of the page block
      // (header 64px + layout padding 12px, minus the 59px nav header)
      paddingBlockStart: 17,
      paddingBlockEnd: theme.spacing(10)
    },
    [`& .${verticalNavClasses.backdrop}`]: {
      backgroundColor: 'var(--backdrop-color)'
    }
  }
}

export default navigationCustomStyles
