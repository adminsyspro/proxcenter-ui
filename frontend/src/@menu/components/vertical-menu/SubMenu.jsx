'use client'

// React Imports
import { Children, cloneElement, forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

// Next Imports
import { usePathname } from 'next/navigation'

// Third-party Imports
import classnames from 'classnames'
import styled from '@emotion/styled'
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useRole,
  useInteractions,
  useClick,
  safePolygon,
  useDismiss,
  hide,
  useFloatingTree,
  FloatingPortal
} from '@floating-ui/react'

// Component Imports
import SubMenuContent from './SubMenuContent'
import MenuButton, { menuButtonStyles } from './MenuButton'

// Icon Imports
import ChevronRight from '../../svg/ChevronRight'

// Hook Imports
import useVerticalNav from '../../hooks/useVerticalNav'
import useVerticalMenu from '../../hooks/useVerticalMenu'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'
import { confirmUrlInChildren, renderMenuIcon } from '../../utils/menuUtils'

// Styled Component Imports
import StyledMenuLabel from '../../styles/StyledMenuLabel'
import StyledMenuPrefix from '../../styles/StyledMenuPrefix'
import StyledMenuSuffix from '../../styles/StyledMenuSuffix'
import StyledVerticalNavExpandIcon, {
  StyledVerticalNavExpandIconWrapper
} from '../../styles/vertical/StyledVerticalNavExpandIcon'

const StyledSubMenu = styled.li`
  position: relative;
  inline-size: 100%;
  margin-block-start: 4px;

  &.${menuClasses.open} > .${menuClasses.button} {
    background-color: #f3f3f3;
  }

  ${({ menuItemStyles }) => menuItemStyles};
  ${({ rootStyles }) => rootStyles};

  > .${menuClasses.button} {
    ${({ level, disabled, active, children, isCollapsed, isPopoutWhenCollapsed }) =>
      menuButtonStyles({
        level,
        active,
        disabled,
        children,
        isCollapsed,
        isPopoutWhenCollapsed
      })};
    ${({ buttonStyles }) => buttonStyles};
  }
`

const SubMenu = (props, ref) => {
  // Props
  const {
    children,
    className,
    contentClassName,
    label,
    icon,
    title,
    prefix,
    suffix,
    defaultOpen,
    level = 0,
    disabled = false,
    rootStyles,
    component,
    onOpenChange,
    onClick,
    onKeyUp,
    ...rest
  } = props

  // States
  const [openWhenCollapsed, setOpenWhenCollapsed] = useState(false)
  const [active, setActive] = useState(false)

  // Refs
  const contentRef = useRef(null)

  // Hooks
  const id = useId()
  const pathname = usePathname()
  const { isCollapsed, isPopoutWhenCollapsed, isHovered, isBreakpointReached } = useVerticalNav()
  const tree = useFloatingTree()

  const {
    browserScroll,
    triggerPopout,
    renderExpandIcon,
    renderExpandedMenuItemIcon,
    menuItemStyles,
    openSubmenu,
    toggleOpenSubmenu,
    transitionDuration,
    openSubmenusRef,
    popoutMenuOffset,
    textTruncate
  } = useVerticalMenu()

  // Vars
  // Filter out falsy values from children
  const childNodes = Children.toArray(children).filter(Boolean)

  const mainAxisOffset =
    popoutMenuOffset &&
    popoutMenuOffset.mainAxis &&
    (typeof popoutMenuOffset.mainAxis === 'function' ? popoutMenuOffset.mainAxis({ level }) : popoutMenuOffset.mainAxis)

  const alignmentAxisOffset =
    popoutMenuOffset &&
    popoutMenuOffset.alignmentAxis &&
    (typeof popoutMenuOffset.alignmentAxis === 'function'
      ? popoutMenuOffset.alignmentAxis({ level })
      : popoutMenuOffset.alignmentAxis)

  const { refs, floatingStyles, context } = useFloating({
    strategy: 'fixed',
    open: openWhenCollapsed,
    onOpenChange: setOpenWhenCollapsed,
    placement: 'right-start',
    middleware: [
      offset({
        mainAxis: mainAxisOffset,
        alignmentAxis: alignmentAxisOffset
      }),
      flip({ crossAxis: false }),
      shift(),
      hide()
    ],
    whileElementsMounted: autoUpdate
  })

  const hover = useHover(context, {
    handleClose: safePolygon({
      blockPointerEvents: true
    }), // safePolygon function allows us to reach to submenu
    restMs: 25, // Only opens submenu when cursor rests for 25ms on a menu
    enabled: triggerPopout === 'hover', // Only enable hover effect when triggerPopout option is set to 'hover'
    delay: { open: 75 } // Delay opening submenu by 75ms
  })

  const click = useClick(context, {
    enabled: triggerPopout === 'click' // Only enable click effect when triggerPopout option is set to 'click'
  })

  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'menu' })

  // Merge all the interactions into prop getters
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([hover, click, dismiss, role])
  const isSubMenuOpen = openSubmenu?.some(item => item.id === id) ?? false

  const handleSlideToggle = () => {
    if (level === 0 && isCollapsed && !isHovered) {
      return
    }

    toggleOpenSubmenu?.({ level, label, active, id })
    onOpenChange?.(!isSubMenuOpen)
    if (openSubmenusRef?.current && openSubmenusRef?.current.length > 0) openSubmenusRef.current = []
  }

  const handleOnClick = event => {
    onClick?.(event)
    handleSlideToggle()
  }

  const handleOnKeyUp = event => {
    onKeyUp?.(event)

    if (event.key === 'Enter') {
      handleSlideToggle()
    }
  }

  const getSubMenuItemStyles = element => {
    // If the menuItemStyles prop is provided, get the styles for the specified element.
    if (menuItemStyles) {
      // Define the parameters that are passed to the style functions.
      const params = {
        level,
        disabled,
        active,
        isSubmenu: true,
        open: isSubMenuOpen
      }

      // Get the style function for the specified element.
      const styleFunction = menuItemStyles[element]

      if (styleFunction) {
        // If the style function is a function, call it and return the result.
        // Otherwise, return the style function itself.
        return typeof styleFunction === 'function' ? styleFunction(params) : styleFunction
      }
    }
  }

  // Event emitter allows you to communicate across tree components.
  // This effect closes all menus when an item gets clicked anywhere in the tree.
  useEffect(() => {
    const handleTreeClick = () => {
      setOpenWhenCollapsed(false)
    }

    tree?.events.on('click', handleTreeClick)

    return () => {
      tree?.events.off('click', handleTreeClick)
    }
  }, [tree])
  useLayoutEffect(() => {
    if (isCollapsed && level === 0) {
      setOpenWhenCollapsed(false)
    }
  }, [isCollapsed, level, active])
  useEffect(() => {
    if (confirmUrlInChildren(children, pathname)) {
      openSubmenusRef?.current.push({ level, label, active: true, id })
    } else {
      if (defaultOpen) {
        openSubmenusRef?.current.push({ level, label, active: false, id })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Change active state when the url changes
  useEffect(() => {
    // Check if the current url matches any of the children urls
    if (confirmUrlInChildren(children, pathname)) {
      setActive(true)

      if (openSubmenusRef?.current.findIndex(submenu => submenu.id === id) === -1) {
        openSubmenusRef?.current.push({ level, label, active: true, id })
      }
    } else {
      setActive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  /* useEffect(() => {
      console.log(openSubmenu)
    }, [openSubmenu]) */
  const submenuContent = (
    <SubMenuContent
      ref={isCollapsed && level === 0 && isPopoutWhenCollapsed ? refs.setFloating : contentRef}
      {...(isCollapsed && level === 0 && isPopoutWhenCollapsed && getFloatingProps())}
      browserScroll={browserScroll}
      openWhenCollapsed={openWhenCollapsed}
      isPopoutWhenCollapsed={isPopoutWhenCollapsed}
      transitionDuration={transitionDuration}
      open={isSubMenuOpen}
      level={level}
      isCollapsed={isCollapsed}
      isHovered={isHovered}
      className={classnames(menuClasses.subMenuContent, contentClassName)}
      rootStyles={{
        ...(isCollapsed && level === 0 && isPopoutWhenCollapsed && floatingStyles),
        ...getSubMenuItemStyles('subMenuContent')
      }}
    >
      {childNodes.map(node =>
        cloneElement(node, {
          ...getItemProps({
            onClick(event) {
              if (node.props.children && !Array.isArray(node.props.children)) {
                node.props.onClick?.(event)
                tree?.events.emit('click')
              }
            }
          }),
          level: level + 1
        })
      )}
    </SubMenuContent>
  )

  return (
    // eslint-disable-next-line lines-around-comment
    /* Sub Menu */
    <StyledSubMenu
      ref={ref}
      className={classnames(
        menuClasses.subMenuRoot,
        { [menuClasses.active]: active },
        { [menuClasses.disabled]: disabled },
        { [menuClasses.open]: isSubMenuOpen },
        className
      )}
      menuItemStyles={getSubMenuItemStyles('root')}
      level={level}
      isPopoutWhenCollapsed={isPopoutWhenCollapsed}
      disabled={disabled}
      active={active}
      isCollapsed={isCollapsed}
      buttonStyles={getSubMenuItemStyles('button')}
      rootStyles={rootStyles}
    >
      {/* Menu Item */}
      <MenuButton
        ref={isCollapsed && level === 0 && isPopoutWhenCollapsed && !disabled ? refs.setReference : null}
        onClick={handleOnClick}
        {...(isCollapsed && level === 0 && isPopoutWhenCollapsed && !disabled && getReferenceProps())}
        onKeyUp={handleOnKeyUp}
        title={title}
        className={classnames(menuClasses.button, { [menuClasses.active]: active })}
        component={component}
        tabIndex={disabled ? -1 : 0}
        {...rest}
      >
        {/* Sub Menu Icon */}
        {renderMenuIcon({
          icon,
          level,
          active,
          disabled,
          renderExpandedMenuItemIcon,
          styles: getSubMenuItemStyles('icon'),
          isBreakpointReached
        })}

        {/* Sub Menu Prefix */}
        {prefix && (
          <StyledMenuPrefix
            isHovered={isHovered}
            isCollapsed={isCollapsed}
            firstLevel={level === 0}
            className={menuClasses.prefix}
            rootStyles={getSubMenuItemStyles('prefix')}
          >
            {prefix}
          </StyledMenuPrefix>
        )}

        {/* Sub Menu Label */}
        <StyledMenuLabel
          className={menuClasses.label}
          rootStyles={getSubMenuItemStyles('label')}
          textTruncate={textTruncate}
        >
          {label}
        </StyledMenuLabel>

        {/* Sub Menu Suffix */}
        {suffix && (
          <StyledMenuSuffix
            isHovered={isHovered}
            isCollapsed={isCollapsed}
            firstLevel={level === 0}
            className={menuClasses.suffix}
            rootStyles={getSubMenuItemStyles('suffix')}
          >
            {suffix}
          </StyledMenuSuffix>
        )}

        {/* Sub Menu Toggle Icon Wrapper */}
        {isCollapsed && !isHovered && level === 0 ? null : (
          <StyledVerticalNavExpandIconWrapper
            className={menuClasses.subMenuExpandIcon}
            rootStyles={getSubMenuItemStyles('subMenuExpandIcon')}
          >
            {renderExpandIcon ? (
              renderExpandIcon({
                level,
                disabled,
                active,
                open: isSubMenuOpen
              })
            ) : (
              // eslint-disable-next-line lines-around-comment
              /* Expanded Arrow Icon */
              <StyledVerticalNavExpandIcon open={isSubMenuOpen} transitionDuration={transitionDuration}>
                <ChevronRight fontSize='1rem' />
              </StyledVerticalNavExpandIcon>
            )}
          </StyledVerticalNavExpandIconWrapper>
        )}
      </MenuButton>

      {/* Sub Menu Content */}
      {isCollapsed && level === 0 && isPopoutWhenCollapsed ? (
        <FloatingPortal>{openWhenCollapsed && submenuContent}</FloatingPortal>
      ) : (
        submenuContent
      )}
    </StyledSubMenu>
  )
}

export default forwardRef(SubMenu)
