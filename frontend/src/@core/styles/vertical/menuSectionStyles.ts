// Util Imports
import { menuClasses } from '@menu/utils/menuClasses'

// Type Imports
import type { Theme } from '@mui/material/styles'

import type { MenuSectionStyles, VerticalNavState } from '@menu/types'

const menuSectionStyles = (verticalNavOptions: VerticalNavState, theme: Theme): MenuSectionStyles => {
  // Vars
  const { isCollapsed, isHovered, collapsedWidth = 0 } = verticalNavOptions
  const collapsedNotHovered = isCollapsed && !isHovered

  return {
    root: {
      marginBlockStart: theme.spacing(7),
      [`& .${menuClasses.menuSectionContent}`]: {
        color: 'var(--mui-palette-text-disabled)',
        paddingInline: '0 !important',
        paddingBlock: `${theme.spacing(collapsedNotHovered ? 3.875 : 1.75)} !important`,
        gap: collapsedNotHovered ? 0 : theme.spacing(2.5),
        ...(collapsedNotHovered && {
          paddingInlineStart: `${theme.spacing((collapsedWidth - 25) / 8)} !important`,
          paddingInlineEnd: `${theme.spacing((collapsedWidth - 25) / 8 - 1.25)} !important`,

          // Collapsed: a plain rule stands for the section, so its icon no longer reads as a disabled link
          [`& .${menuClasses.icon}`]: {
            display: 'none'
          }
        }),
        '&:before': {
          content: '""',
          blockSize: 1,
          inlineSize: collapsedNotHovered ? '1.3125rem' : '0.875rem',
          backgroundColor: 'var(--mui-palette-divider)'
        },
        ...(!collapsedNotHovered && {
          '&:after': {
            content: '""',
            blockSize: 1,
            flexGrow: 1,
            backgroundColor: 'var(--mui-palette-divider)'
          }
        })
      },
      [`& .${menuClasses.menuSectionLabel}`]: {
        flexGrow: 0,
        fontSize: '13px',
        lineHeight: 1.38462,
        ...(collapsedNotHovered && {
          display: 'none'
        })
      },
      [`& .${menuClasses.icon}`]: {
        ...(collapsedNotHovered && {
          fontSize: '1.375rem',
          marginInlineEnd: 0
        })
      }
    }
  }
}

export default menuSectionStyles
