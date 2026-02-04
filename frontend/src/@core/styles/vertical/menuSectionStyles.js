// Util Imports
import { menuClasses } from '@menu/utils/menuClasses'

const menuSectionStyles = (verticalNavOptions, theme) => {
  // Vars
  const { isCollapsed, isHovered, collapsedWidth } = verticalNavOptions
  const collapsedNotHovered = isCollapsed && !isHovered

  return {
    root: {
      marginBlockStart: theme.spacing(7),
      [`& .${menuClasses.menuSectionContent}`]: {
        color: 'var(--mui-palette-text-disabled)',
        paddingInline: '0 !important',
        paddingBlock: `${theme.spacing(collapsedNotHovered ? 3.875 : 1.75)} !important`,
        gap: theme.spacing(2.5),
        ...(collapsedNotHovered && {
          paddingInlineStart: `${theme.spacing((collapsedWidth - 22) / 8)} !important`,
          paddingInlineEnd: `${theme.spacing(((collapsedWidth - 22) / 2 - 5) / 4)} !important`
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
      }
    }
  }
}

export default menuSectionStyles
