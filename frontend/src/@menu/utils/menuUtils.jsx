// React Imports
import { Children, isValidElement } from 'react'

// Component Imports
import {
  SubMenu as HorizontalSubMenu,
  MenuItem as HorizontalMenuItem,
  Menu as HorizontalMenu
} from '../horizontal-menu'
import { SubMenu as VerticalSubMenu, MenuItem as VerticalMenuItem, Menu as VerticalMenu } from '../vertical-menu'
import { GenerateVerticalMenu } from '@components/GenerateMenu'

// Util Imports
import { menuClasses } from './menuClasses'

// Styled Component Imports
import StyledMenuIcon from '../styles/StyledMenuIcon'

export const confirmUrlInChildren = (children, url) => {
  if (!children) {
    return false
  }

  if (Array.isArray(children)) {
    return children.some(child => confirmUrlInChildren(child, url))
  }

  if (isValidElement(children)) {
    const { component, href, exactMatch, activeUrl, children: subChildren } = children.props

    if (component && typeof component !== 'string' && component.props.href) {
      return exactMatch === true || exactMatch === undefined
        ? component.props.href === url
        : activeUrl !== undefined && url.includes(activeUrl)
    }

    if (href) {
      return exactMatch === true || exactMatch === undefined
        ? href === url
        : activeUrl !== undefined && url.includes(activeUrl)
    }

    if (subChildren) {
      return confirmUrlInChildren(subChildren, url)
    }
  }

  return false
}

/*
 * Reason behind mapping the children of the horizontal-menu component to the vertical-menu component:
 * The Horizontal menu components will not work inside of Vertical menu on small screens.
 * So, we have to map the children of the horizontal-menu components to the vertical-menu components.
 * We also kept the same names and almost similar props for menuitem and submenu components for easy mapping.
 */
/**
 * Processes children of a HorizontalMenu component to either generate a vertical menu directly
 * from menuData or apply a transformation function to each child.
 *
 * @param {ReactNode} children - The children of the HorizontalMenu component.
 * @param {Function} mapFunction - A function to transform each child that doesn't have menuData.
 * @returns {ReactNode} The processed children suitable for inclusion in a VerticalMenu.
 */
const processMenuChildren = (children, mapFunction) => {
  return Children.map(children, child => {
    // Skip processing for non-React elements
    if (!isValidElement(child)) return child

    // If child has menuData prop, create a GenerateVerticalMenu component
    // Otherwise, apply the transformation function to the child
    return child.props.menuData ? <GenerateVerticalMenu menuData={child.props.menuData} /> : mapFunction(child)
  })
}

/**
 * Transforms a hierarchy of horizontal menu components (HorizontalMenuItem,
 * HorizontalSubMenu, and HorizontalMenu) into their vertical equivalents.
 *
 * @param {ReactNode} children - The children of the menu to be transformed.
 * @returns {ReactNode} The transformed menu as a hierarchy of vertical menu components.
 */
export const mapHorizontalToVerticalMenu = children => {
  return Children.map(children, child => {
    // If the child is not a valid React element, exclude it from the output
    if (!isValidElement(child)) return null

    // Destructure to separate specific props and rest props for further use
    const { children: childChildren, verticalMenuProps, ...rest } = child.props

    // Use a switch statement to handle different types of menu items
    switch (child.type) {
      case HorizontalMenuItem:
        // Directly transform HorizontalMenuItem to VerticalMenuItem
        return <VerticalMenuItem {...rest}>{childChildren}</VerticalMenuItem>
      case HorizontalSubMenu:
        // Transform HorizontalSubMenu to VerticalSubMenu, recursively transforming its children
        // The rest props from HorizontalSubMenu include all required VerticalSubMenu props like label
        return <VerticalSubMenu {...rest}>{mapHorizontalToVerticalMenu(childChildren)}</VerticalSubMenu>
      case HorizontalMenu:
        // For HorizontalMenu, process its children specifically, then wrap in VerticalMenu
        const transformedChildren = processMenuChildren(childChildren, mapHorizontalToVerticalMenu)

        return <VerticalMenu {...(verticalMenuProps || {})}>{transformedChildren}</VerticalMenu>
      default:
        // For any other type of child, return it without modification
        return child
    }
  })
}

/*
 * Render all the icons for Menu Item and SubMenu components for all the levels more than 0
 */
export const renderMenuIcon = params => {
  const { icon, level, active, disabled, styles, renderExpandedMenuItemIcon, isBreakpointReached } = params

  if (icon && (level === 0 || (!isBreakpointReached && level && level > 0))) {
    return (
      <StyledMenuIcon className={menuClasses.icon} rootStyles={styles}>
        {icon}
      </StyledMenuIcon>
    )
  }

  if (
    level &&
    level !== 0 &&
    renderExpandedMenuItemIcon &&
    renderExpandedMenuItemIcon.icon !== null &&
    (!renderExpandedMenuItemIcon.level || renderExpandedMenuItemIcon.level >= level)
  ) {
    const iconToRender =
      typeof renderExpandedMenuItemIcon.icon === 'function'
        ? renderExpandedMenuItemIcon.icon({ level, active, disabled })
        : renderExpandedMenuItemIcon.icon

    if (iconToRender) {
      return (
        <StyledMenuIcon className={menuClasses.icon} rootStyles={styles}>
          {iconToRender}
        </StyledMenuIcon>
      )
    }
  }

  return null
}
