'use client'

// React Imports
import { createContext, forwardRef, useMemo } from 'react'

// Third-party Imports
import classnames from 'classnames'
import { FloatingTree } from '@floating-ui/react'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Styled Component Imports
import StyledHorizontalMenu from '../../styles/horizontal/StyledHorizontalMenu'

// Style Imports
import styles from '../../styles/horizontal/horizontalUl.module.css'

// Default Config Imports
import { horizontalSubMenuToggleDuration } from '../../defaultConfigs'

export const HorizontalMenuContext = createContext({})

const Menu = (props, ref) => {
  // Props
  const {
    children,
    className,
    rootStyles,
    menuItemStyles,
    triggerPopout = 'hover',
    browserScroll = false,
    transitionDuration = horizontalSubMenuToggleDuration,
    renderExpandIcon,
    renderExpandedMenuItemIcon,
    popoutMenuOffset = { mainAxis: 0 },
    textTruncate = true,
    verticalMenuProps,
    ...rest
  } = props

  const providerValue = useMemo(
    () => ({
      triggerPopout,
      browserScroll,
      menuItemStyles,
      renderExpandIcon,
      renderExpandedMenuItemIcon,
      transitionDuration,
      popoutMenuOffset,
      textTruncate,
      verticalMenuProps
    }),
    [
      triggerPopout,
      browserScroll,
      menuItemStyles,
      renderExpandIcon,
      renderExpandedMenuItemIcon,
      transitionDuration,
      popoutMenuOffset,
      textTruncate,
      verticalMenuProps
    ]
  )

  return (
    <HorizontalMenuContext.Provider value={providerValue}>
      <FloatingTree>
        <StyledHorizontalMenu
          ref={ref}
          className={classnames(menuClasses.root, className)}
          rootStyles={rootStyles}
          {...rest}
        >
          <ul className={styles.root}>{children}</ul>
        </StyledHorizontalMenu>
      </FloatingTree>
    </HorizontalMenuContext.Provider>
  )
}

export default forwardRef(Menu)
