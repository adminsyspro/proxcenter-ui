'use client'

// React Imports
import { isValidElement } from 'react'
import type { ReactNode } from 'react'

// MUI Imports
import Chip from '@mui/material/Chip'
import type { ChipProps } from '@mui/material/Chip'

// Type Imports
import type { MenuAdornment, MenuDataItem } from '@menu/types'

// Component Imports
import { SubMenu as HorizontalSubMenu, MenuItem as HorizontalMenuItem } from '@menu/horizontal-menu'
import { SubMenu as VerticalSubMenu, MenuItem as VerticalMenuItem, MenuSection } from '@menu/vertical-menu'

// RBAC Hook
import { useRBAC } from '@/contexts/RBACContext'
import { hasInfraScope } from '@/lib/rbac/scopeKinds'

// License Hook
import { useLicense } from '@/contexts/LicenseContext'

// VDC Hook
import { useMyVdcs } from '@/hooks/useMyVdcs'

// Tenant Hook
import { useTenant } from '@/contexts/TenantContext'

const isChip = (value: MenuAdornment): value is ChipProps & { label: ReactNode } =>
  typeof value === 'object' && value !== null && !isValidElement(value) && 'label' in value && Boolean(value.label)

// A chip description becomes a Chip; anything else is rendered as given.
const renderAdornment = (value: MenuAdornment): ReactNode =>
  isChip(value) ? <Chip size='small' {...value} /> : value

// Generate a menu from the menu data array
export const GenerateVerticalMenu = ({ menuData }: { menuData: MenuDataItem[] }) => {
  const { hasAnyPermission, scopeTypes, isAdmin, loading } = useRBAC()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const { hasVdc, loading: vdcLoading } = useMyVdcs()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProviderTenant = currentTenant?.id === 'default'
  // A vDC tenant: neither the provider nor an MSP running its own clusters.
  const isVdcTenant = !!currentTenant && !isProviderTenant && currentTenant.operatingModel !== 'msp'
  const infraScoped = hasInfraScope(scopeTypes, isAdmin)

  // Fonction pour vérifier si un item doit être affiché (RBAC)
  const canView = (item: MenuDataItem) => {
    if (loading || vdcLoading || tenantLoading) return true // Afficher pendant le chargement
    if (item.requires?.hasVdc === true && !hasVdc) return false
    if (item.requires?.hasVdc === false && hasVdc) return false
    if (item.requires?.isProviderTenant === true && !isProviderTenant) return false
    if (item.requires?.notVdcTenant === true && isVdcTenant) return false
    if (item.requires?.infraScope === true && !infraScoped) return false
    if (!item.permissions || item.permissions.length === 0) return true

    return hasAnyPermission(item.permissions)
  }

  // Fonction pour vérifier si la feature de licence est disponible
  const hasRequiredFeature = (item: MenuDataItem) => {
    if (licenseLoading) return true // Afficher pendant le chargement
    if (!item.requiredFeature) return true // Pas de feature requise
    return hasFeature(item.requiredFeature)
  }

  // Fonction pour filtrer les enfants accessibles (RBAC + licence)
  const filterChildren = (children?: MenuDataItem[]) => {
    if (!children) return []

    return children.filter(child => canView(child) && hasRequiredFeature(child))
  }

  const renderMenuItems = (data: MenuDataItem[]): ReactNode[] => {
    return data.map((item, index) => {
      const menuSectionItem = item
      const subMenuItem = item
      const menuItem = item

      // Check if the current item is a section
      if (menuSectionItem.isSection) {
        const { children, isSection, icon, permissions, requiredFeature, prefix, suffix, ...rest } = menuSectionItem

        // Filtrer les enfants accessibles
        const filteredChildren = filterChildren(children)

        // Ne pas afficher la section si elle n'a pas d'enfants accessibles
        if (filteredChildren.length === 0) return null

        // Vérifier aussi les permissions de la section elle-même
        if (permissions && permissions.length > 0 && !hasAnyPermission(permissions)) {
          return null
        }

        const SectionIcon = icon ? <i className={icon} /> : null

        return (
          <MenuSection
            key={index}
            prefix={renderAdornment(prefix)}
            suffix={renderAdornment(suffix)}
            {...rest}
            {...(SectionIcon && { icon: SectionIcon })}
          >
            {renderMenuItems(filteredChildren)}
          </MenuSection>
        )
      }

      // Vérifier les permissions de l'item
      if (!canView(item)) return null

      // Masquer les items dont la feature de licence n'est pas disponible
      if (!hasRequiredFeature(item)) return null

      // Check if the current item is a sub menu
      if (subMenuItem.children) {
        const { children, icon, prefix, suffix, permissions, requiredFeature, ...rest } = subMenuItem

        // Filtrer les enfants accessibles
        const filteredChildren = filterChildren(children)

        // Ne pas afficher le sous-menu s'il n'a pas d'enfants accessibles
        if (filteredChildren.length === 0) return null

        const Icon = icon ? <i className={icon} /> : null
        const subMenuPrefix = renderAdornment(prefix)
        const subMenuSuffix = renderAdornment(suffix)

        return (
          <VerticalSubMenu
            key={index}
            prefix={subMenuPrefix}
            suffix={subMenuSuffix}
            {...rest}
            {...(Icon && { icon: Icon })}
          >
            {renderMenuItems(filteredChildren)}
          </VerticalSubMenu>
        )
      }

      // If the current item is neither a section nor a sub menu, return a MenuItem component
      const { label, icon, prefix, suffix, permissions, requiredFeature, requires, ...rest } = menuItem

      const Icon = icon ? <i className={icon} /> : null
      const menuItemPrefix = renderAdornment(prefix)
      const menuItemSuffix = renderAdornment(suffix)

      return (
        <VerticalMenuItem
          key={index}
          prefix={menuItemPrefix}
          suffix={menuItemSuffix}
          {...rest}
          {...(Icon && { icon: Icon })}
        >
          {label}
        </VerticalMenuItem>
      )
    }).filter(Boolean) // Filtrer les null
  }

  return <>{renderMenuItems(menuData)}</>
}

// Generate a menu from the menu data array
export const GenerateHorizontalMenu = ({ menuData }: { menuData: MenuDataItem[] }) => {
  const { hasAnyPermission, scopeTypes, isAdmin, loading } = useRBAC()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const { hasVdc, loading: vdcLoading } = useMyVdcs()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProviderTenant = currentTenant?.id === 'default'
  // A vDC tenant: neither the provider nor an MSP running its own clusters.
  const isVdcTenant = !!currentTenant && !isProviderTenant && currentTenant.operatingModel !== 'msp'
  const infraScoped = hasInfraScope(scopeTypes, isAdmin)

  const canView = (item: MenuDataItem) => {
    if (loading || vdcLoading || tenantLoading) return true // Afficher pendant le chargement
    if (item.requires?.hasVdc === true && !hasVdc) return false
    if (item.requires?.hasVdc === false && hasVdc) return false
    if (item.requires?.isProviderTenant === true && !isProviderTenant) return false
    if (item.requires?.notVdcTenant === true && isVdcTenant) return false
    if (item.requires?.infraScope === true && !infraScoped) return false
    if (!item.permissions || item.permissions.length === 0) return true

    return hasAnyPermission(item.permissions)
  }

  const hasRequiredFeature = (item: MenuDataItem) => {
    if (licenseLoading) return true
    if (!item.requiredFeature) return true
    return hasFeature(item.requiredFeature)
  }

  const filterChildren = (children?: MenuDataItem[]) => {
    if (!children) return []

    return children.filter(child => canView(child) && hasRequiredFeature(child))
  }

  const renderMenuItems = (data: MenuDataItem[]): ReactNode[] => {
    return data.map((item, index) => {
      const subMenuItem = item
      const menuItem = item

      // Vérifier les permissions
      if (!canView(item)) return null

      // Masquer les items dont la feature de licence n'est pas disponible
      if (!hasRequiredFeature(item)) return null

      // Check if the current item is a sub menu
      if (subMenuItem.children) {
        const { children, icon, prefix, suffix, permissions, requiredFeature, ...rest } = subMenuItem

        const filteredChildren = filterChildren(children)

        if (filteredChildren.length === 0) return null

        const Icon = icon ? <i className={icon} /> : null
        const subMenuPrefix = renderAdornment(prefix)
        const subMenuSuffix = renderAdornment(suffix)

        return (
          <HorizontalSubMenu
            key={index}
            prefix={subMenuPrefix}
            suffix={subMenuSuffix}
            {...rest}
            {...(Icon && { icon: Icon })}
          >
            {renderMenuItems(filteredChildren)}
          </HorizontalSubMenu>
        )
      }

      // If the current item is not a sub menu, return a MenuItem component
      const { label, icon, prefix, suffix, permissions, requiredFeature, requires, ...rest } = menuItem

      const Icon = icon ? <i className={icon} /> : null
      const menuItemPrefix = renderAdornment(prefix)
      const menuItemSuffix = renderAdornment(suffix)

      return (
        <HorizontalMenuItem
          key={index}
          prefix={menuItemPrefix}
          suffix={menuItemSuffix}
          {...rest}
          {...(Icon && { icon: Icon })}
        >
          {label}
        </HorizontalMenuItem>
      )
    }).filter(Boolean)
  }

  return <>{renderMenuItems(menuData)}</>
}
