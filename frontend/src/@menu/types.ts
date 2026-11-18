import type {
  AnchorHTMLAttributes,
  HTMLAttributes,
  ReactElement,
  ReactNode,
  RefAttributes,
  RefObject
} from 'react'

import type { CSSObject, SerializedStyles } from '@emotion/react'
import type { ChipProps } from '@mui/material/Chip'

export type BreakpointType = 'xxl' | 'xl' | 'lg' | 'md' | 'sm' | 'xs' | 'always'

// What a styled menu element accepts as injected styles.
export type ElementStyles = CSSObject | SerializedStyles | false | null

export interface RootStylesProps {
  rootStyles?: ElementStyles
}

export interface MenuItemStylesParams {
  level: number
  disabled: boolean
  active?: boolean
  isSubmenu: boolean
  open?: boolean
}

export type MenuItemElement =
  | 'root'
  | 'button'
  | 'icon'
  | 'label'
  | 'prefix'
  | 'suffix'
  | 'subMenuContent'
  | 'subMenuExpandIcon'
  | 'subMenuStyles'

export type MenuItemStyle = CSSObject | ((params: MenuItemStylesParams) => CSSObject | undefined)

export type MenuItemStyles = Partial<Record<MenuItemElement, MenuItemStyle>>

export type MenuSectionElement = 'root' | 'icon' | 'label' | 'prefix' | 'suffix'

export type MenuSectionStyles = Partial<Record<MenuSectionElement, CSSObject>>

export interface RenderExpandIconParams {
  level: number
  disabled: boolean
  active: boolean
  open: boolean
}

export interface RenderExpandedMenuItemIconParams {
  level?: number
  active?: boolean
  disabled?: boolean
}

export interface RenderExpandedMenuItemIcon {
  icon: ReactNode | ((params: RenderExpandedMenuItemIconParams) => ReactNode)
  level?: number
}

// The element a menu button renders as: a tag name, or an element to clone
// (typically a Next.js Link carrying its own href).
export type MenuButtonComponent =
  | string
  | ReactElement<AnchorHTMLAttributes<HTMLAnchorElement> & RefAttributes<HTMLAnchorElement>>

export interface OpenSubmenu {
  level: number
  label: ReactNode
  active: boolean
  id: string
}

export interface VerticalNavState {
  width?: number
  collapsedWidth?: number
  isCollapsed?: boolean
  isHovered?: boolean
  isToggled?: boolean
  isScrollWithContent?: boolean
  isBreakpointReached?: boolean
  isPopoutWhenCollapsed?: boolean
  collapsing?: boolean
  expanding?: boolean
  transitionDuration?: number
}

export interface VerticalNavContextValue extends VerticalNavState {
  updateVerticalNavState: (values: VerticalNavState) => void
  collapseVerticalNav: (value?: boolean) => void
  hoverVerticalNav: (value?: boolean) => void
  toggleVerticalNav: (value?: boolean) => void
}

export interface HorizontalNavContextValue {
  isBreakpointReached: boolean
  updateIsBreakpointReached: (value: boolean) => void
}

export type PopoutOffsetValue = number | ((params: { level: number }) => number)

export interface PopoutMenuOffset {
  mainAxis?: PopoutOffsetValue
  alignmentAxis?: PopoutOffsetValue
}

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'prefix'>

export type MenuButtonProps = AnchorProps & { component?: MenuButtonComponent }

export type MenuItemProps = AnchorProps &
  RootStylesProps & {
    icon?: ReactNode
    prefix?: ReactNode
    suffix?: ReactNode
    level?: number
    disabled?: boolean
    exactMatch?: boolean
    activeUrl?: string
    component?: MenuButtonComponent
    onActiveChange?: (active: boolean) => void
  }

export type SubMenuProps = AnchorProps &
  RootStylesProps & {
    label: ReactNode
    icon?: ReactNode
    prefix?: ReactNode
    suffix?: ReactNode
    contentClassName?: string
    defaultOpen?: boolean
    level?: number
    disabled?: boolean
    component?: MenuButtonComponent
    onOpenChange?: (open: boolean) => void
  }

export type MenuSectionProps = Omit<HTMLAttributes<HTMLUListElement>, 'prefix'> &
  RootStylesProps & {
    label?: ReactNode
    icon?: ReactNode
    prefix?: ReactNode
    suffix?: ReactNode
  }

export type TriggerPopout = 'hover' | 'click'

interface SharedMenuProps extends HTMLAttributes<HTMLElement>, RootStylesProps {
  menuItemStyles?: MenuItemStyles
  renderExpandIcon?: (params: RenderExpandIconParams) => ReactNode
  renderExpandedMenuItemIcon?: RenderExpandedMenuItemIcon
  browserScroll?: boolean
  triggerPopout?: TriggerPopout
  transitionDuration?: number
  popoutMenuOffset?: PopoutMenuOffset
  textTruncate?: boolean
}

export interface VerticalMenuProps extends SharedMenuProps {
  menuSectionStyles?: MenuSectionStyles
  popoutWhenCollapsed?: boolean
  subMenuOpenBehavior?: 'accordion' | 'collapse'
  collapsedMenuSectionLabel?: ReactNode
}

export interface HorizontalMenuProps extends SharedMenuProps {
  verticalMenuProps?: VerticalMenuProps
}

type SharedMenuContextValue = Pick<
  SharedMenuProps,
  | 'menuItemStyles'
  | 'renderExpandIcon'
  | 'renderExpandedMenuItemIcon'
  | 'browserScroll'
  | 'triggerPopout'
  | 'transitionDuration'
  | 'popoutMenuOffset'
  | 'textTruncate'
>

// A submenu as a caller reports it: `active` defaults to false.
export type ToggledSubmenu = Omit<OpenSubmenu, 'active'> & { active?: boolean }

export interface VerticalMenuContextValue extends SharedMenuContextValue {
  menuSectionStyles?: MenuSectionStyles
  subMenuOpenBehavior?: 'accordion' | 'collapse'
  collapsedMenuSectionLabel?: ReactNode
  openSubmenu?: OpenSubmenu[]
  openSubmenusRef?: RefObject<OpenSubmenu[]>
  toggleOpenSubmenu?: (...submenus: ToggledSubmenu[]) => void
}

export interface HorizontalMenuContextValue extends SharedMenuContextValue {
  verticalMenuProps?: VerticalMenuProps
}

export interface VerticalNavProps extends HTMLAttributes<HTMLElement> {
  width?: number
  collapsedWidth?: number
  defaultCollapsed?: boolean
  backgroundColor?: string
  backgroundImage?: string
  breakpoint?: BreakpointType
  customBreakpoint?: string
  breakpoints?: Partial<Record<BreakpointType, string>>
  transitionDuration?: number
  backdropColor?: string
  scrollWithContent?: boolean
  customStyles?: ElementStyles
}

export interface MenuRequirements {
  hasVdc?: boolean
  isProviderTenant?: boolean
  notVdcTenant?: boolean
  infraScope?: boolean
}

// A chip drawn before or after a label, or any node rendered as is.
export type MenuAdornment = ReactNode | (ChipProps & { label: ReactNode })

// One entry of the navigation tree, as menuData() declares it.
export interface MenuDataItem {
  label: string
  icon?: string
  href?: string
  isSection?: boolean
  children?: MenuDataItem[]
  permissions?: string[]
  requiredFeature?: string
  requires?: MenuRequirements
  prefix?: MenuAdornment
  suffix?: MenuAdornment
}
