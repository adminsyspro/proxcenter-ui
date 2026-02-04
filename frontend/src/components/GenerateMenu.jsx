'use client'

// MUI Imports
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'

// Component Imports
import { SubMenu as HorizontalSubMenu, MenuItem as HorizontalMenuItem } from '@menu/horizontal-menu'
import { SubMenu as VerticalSubMenu, MenuItem as VerticalMenuItem, MenuSection } from '@menu/vertical-menu'

// RBAC Hook
import { useRBAC } from '@/contexts/RBACContext'

// License Hook
import { useLicense } from '@/contexts/LicenseContext'

// i18n
import { useTranslations } from 'next-intl'

// Generate a menu from the menu data array
export const GenerateVerticalMenu = ({ menuData }) => {
  const { hasAnyPermission, loading } = useRBAC()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const t = useTranslations()

  // Fonction pour vérifier si un item doit être affiché (RBAC)
  const canView = (item) => {
    if (loading) return true // Afficher pendant le chargement
    if (!item.permissions || item.permissions.length === 0) return true

    return hasAnyPermission(item.permissions)
  }

  // Fonction pour vérifier si la feature de licence est disponible
  const hasRequiredFeature = (item) => {
    if (licenseLoading) return true // Afficher pendant le chargement
    if (!item.requiredFeature) return true // Pas de feature requise
    return hasFeature(item.requiredFeature)
  }

  // Fonction pour filtrer les enfants accessibles
  const filterChildren = (children) => {
    if (!children) return []

    return children.filter(child => canView(child))
  }

  const renderMenuItems = data => {
    return data.map((item, index) => {
      const menuSectionItem = item
      const subMenuItem = item
      const menuItem = item

      // Check if the current item is a section
      if (menuSectionItem.isSection) {
        const { children, isSection, permissions, requiredFeature, ...rest } = menuSectionItem

        // Filtrer les enfants accessibles
        const filteredChildren = filterChildren(children)

        // Ne pas afficher la section si elle n'a pas d'enfants accessibles
        if (filteredChildren.length === 0) return null

        // Vérifier aussi les permissions de la section elle-même
        if (permissions && permissions.length > 0 && !hasAnyPermission(permissions)) {
          return null
        }

        return (
          <MenuSection key={index} {...rest}>
            {renderMenuItems(filteredChildren)}
          </MenuSection>
        )
      }

      // Vérifier les permissions de l'item
      if (!canView(item)) return null

      // Vérifier si la feature de licence est disponible
      const featureAvailable = hasRequiredFeature(item)

      // Check if the current item is a sub menu
      if (subMenuItem.children) {
        const { children, icon, prefix, suffix, permissions, requiredFeature, ...rest } = subMenuItem

        // Filtrer les enfants accessibles
        const filteredChildren = filterChildren(children)

        // Ne pas afficher le sous-menu s'il n'a pas d'enfants accessibles
        if (filteredChildren.length === 0) return null

        const Icon = icon ? <i className={icon} style={!featureAvailable ? { opacity: 0.4 } : {}} /> : null
        const subMenuPrefix = prefix && prefix.label ? <Chip size='small' {...prefix} /> : prefix

        // Ajouter un badge "Enterprise" si feature non disponible
        const subMenuSuffix = !featureAvailable ? (
          <Chip
            size='small'
            label='Enterprise'
            sx={{
              height: 20,
              fontSize: '0.65rem',
              fontWeight: 600,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '& .MuiChip-label': { px: 1.25 }
            }}
          />
        ) : (suffix && suffix.label ? <Chip size='small' {...suffix} /> : suffix)

        return (
          <VerticalSubMenu
            key={index}
            prefix={subMenuPrefix}
            suffix={subMenuSuffix}
            {...rest}
            {...(Icon && { icon: Icon })}
            disabled={!featureAvailable}
            rootStyles={!featureAvailable ? { opacity: 0.5, pointerEvents: 'none' } : {}}
          >
            {renderMenuItems(filteredChildren)}
          </VerticalSubMenu>
        )
      }

      // If the current item is neither a section nor a sub menu, return a MenuItem component
      const { label, icon, prefix, suffix, permissions, requiredFeature, ...rest } = menuItem

      const href = featureAvailable ? rest.href : undefined
      const Icon = icon ? <i className={icon} style={!featureAvailable ? { opacity: 0.4 } : {}} /> : null
      const menuItemPrefix = prefix && prefix.label ? <Chip size='small' {...prefix} /> : prefix

      // Ajouter un badge "Enterprise" si feature non disponible
      const menuItemSuffix = !featureAvailable ? (
        <Chip
          size='small'
          label='Enterprise'
          sx={{
            height: 20,
            fontSize: '0.65rem',
            fontWeight: 600,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '& .MuiChip-label': { px: 1.25 }
          }}
        />
      ) : (suffix && suffix.label ? <Chip size='small' {...suffix} /> : suffix)

      const menuItemContent = (
        <VerticalMenuItem
          key={index}
          prefix={menuItemPrefix}
          suffix={menuItemSuffix}
          {...rest}
          href={href}
          {...(Icon && { icon: Icon })}
          disabled={!featureAvailable}
          rootStyles={!featureAvailable ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
        >
          {label}
        </VerticalMenuItem>
      )

      if (!featureAvailable) {
        return (
          <Tooltip key={index} title={t('license.enterpriseRequired')} placement='right'>
            <span>{menuItemContent}</span>
          </Tooltip>
        )
      }

      return menuItemContent
    }).filter(Boolean) // Filtrer les null
  }

  return <>{renderMenuItems(menuData)}</>
}

// Generate a menu from the menu data array
export const GenerateHorizontalMenu = ({ menuData }) => {
  const { hasAnyPermission, loading } = useRBAC()
  const { hasFeature, loading: licenseLoading } = useLicense()
  const t = useTranslations()

  const canView = (item) => {
    if (loading) return true
    if (!item.permissions || item.permissions.length === 0) return true

    return hasAnyPermission(item.permissions)
  }

  const hasRequiredFeature = (item) => {
    if (licenseLoading) return true
    if (!item.requiredFeature) return true
    return hasFeature(item.requiredFeature)
  }

  const filterChildren = (children) => {
    if (!children) return []

    return children.filter(child => canView(child))
  }

  const renderMenuItems = data => {
    return data.map((item, index) => {
      const subMenuItem = item
      const menuItem = item

      // Vérifier les permissions
      if (!canView(item)) return null

      const featureAvailable = hasRequiredFeature(item)

      // Check if the current item is a sub menu
      if (subMenuItem.children) {
        const { children, icon, prefix, suffix, permissions, requiredFeature, ...rest } = subMenuItem

        const filteredChildren = filterChildren(children)

        if (filteredChildren.length === 0) return null

        const Icon = icon ? <i className={icon} style={!featureAvailable ? { opacity: 0.4 } : {}} /> : null
        const subMenuPrefix = prefix && prefix.label ? <Chip size='small' {...prefix} /> : prefix
        const subMenuSuffix = !featureAvailable ? (
          <Chip size='small' label='Enterprise' sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, bgcolor: 'primary.main', color: 'primary.contrastText' }} />
        ) : (suffix && suffix.label ? <Chip size='small' {...suffix} /> : suffix)

        return (
          <HorizontalSubMenu
            key={index}
            prefix={subMenuPrefix}
            suffix={subMenuSuffix}
            {...rest}
            {...(Icon && { icon: Icon })}
            disabled={!featureAvailable}
          >
            {renderMenuItems(filteredChildren)}
          </HorizontalSubMenu>
        )
      }

      // If the current item is not a sub menu, return a MenuItem component
      const { label, icon, prefix, suffix, permissions, requiredFeature, ...rest } = menuItem

      const href = featureAvailable ? rest.href : undefined
      const Icon = icon ? <i className={icon} style={!featureAvailable ? { opacity: 0.4 } : {}} /> : null
      const menuItemPrefix = prefix && prefix.label ? <Chip size='small' {...prefix} /> : prefix
      const menuItemSuffix = !featureAvailable ? (
        <Chip size='small' label='Enterprise' sx={{ height: 20, fontSize: '0.65rem', fontWeight: 600, bgcolor: 'primary.main', color: 'primary.contrastText' }} />
      ) : (suffix && suffix.label ? <Chip size='small' {...suffix} /> : suffix)

      return (
        <HorizontalMenuItem
          key={index}
          prefix={menuItemPrefix}
          suffix={menuItemSuffix}
          {...rest}
          href={href}
          {...(Icon && { icon: Icon })}
          disabled={!featureAvailable}
        >
          {label}
        </HorizontalMenuItem>
      )
    }).filter(Boolean)
  }

  return <>{renderMenuItems(menuData)}</>
}
