'use client'

import { useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Box, Popover, Typography } from '@mui/material'
import { useTheme, darken, alpha } from '@mui/material/styles'

import { menuData } from '@/@menu/menuData'
import { useRBAC } from '@/contexts/RBACContext'
import { useLicense } from '@/contexts/LicenseContext'

const VCenterBurgerMenu = ({ anchorEl, open, onClose }) => {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations()
  const theme = useTheme()
  const { hasPermission } = useRBAC()
  const { hasFeature } = useLicense()

  // vCenter exact colors (dark charcoal/indigo)
  const primaryColor = theme.palette.primary.main
  const menuBg = '#1e1e2d'
  const menuBorder = '#333348'
  const menuHover = '#3a3a52'
  const accentLight = theme.palette.primary.light || primaryColor

  const sections = useMemo(() => {
    const data = menuData(t)
    const result = []

    for (const item of data) {
      if (!item.isSection) {
        result.push({
          standalone: true,
          label: item.label,
          icon: item.icon,
          href: item.href,
          locked: false
        })
        continue
      }

      if (item.permissions && !item.permissions.some(p => hasPermission(p))) continue

      const sectionLocked = item.requiredFeature && !hasFeature(item.requiredFeature)

      const children = (item.children || []).filter(child => {
        if (child.permissions && !child.permissions.some(p => hasPermission(p))) return false
        return true
      }).map(child => ({
        label: child.label,
        icon: child.icon,
        href: child.href,
        locked: sectionLocked || (child.requiredFeature && !hasFeature(child.requiredFeature))
      }))

      if (children.length > 0) {
        result.push({
          isSection: true,
          label: item.label,
          children
        })
      }
    }

    return result
  }, [t, hasPermission, hasFeature])

  const handleNavigate = (href, locked) => {
    if (locked) return
    router.push(href)
    onClose()
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      className='vcenter-burger-menu'
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      sx={{ zIndex: 10001 }}
      slotProps={{
        paper: {
          className: 'no-theme-override',
          sx: {
            backgroundColor: `${menuBg} !important`,
            border: `1px solid ${menuBorder}`,
            borderRadius: '4px',
            mt: 0.5,
            width: { xs: '95vw', sm: 520, md: 680 },
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            color: '#fff !important',
            '& *': { color: 'inherit !important' }
          }
        }
      }}
    >
      <Box sx={{ p: 2 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2.5
          }}
        >
          {sections.map((section, idx) => {
            if (section.standalone) {
              return (
                <Box key={idx}>
                  <Box
                    onClick={() => handleNavigate(section.href, section.locked)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1,
                      py: 0.75,
                      borderRadius: '3px',
                      cursor: 'pointer',
                      backgroundColor: pathname === section.href ? alpha(primaryColor, 0.2) : 'transparent',
                      '&:hover': { backgroundColor: menuHover },
                      transition: 'background-color 150ms'
                    }}
                  >
                    <i className={section.icon} style={{ color: accentLight, fontSize: 18 }} />
                    <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>
                      {section.label}
                    </Typography>
                  </Box>
                </Box>
              )
            }

            return (
              <Box key={idx}>
                <Typography
                  sx={{
                    color: 'rgba(255,255,255,0.45)',
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    mb: 0.75,
                    px: 1
                  }}
                >
                  {section.label}
                </Typography>
                {section.children.map((child, cidx) => {
                  const isActive = pathname?.startsWith(child.href)
                  return (
                    <Box
                      key={cidx}
                      onClick={() => handleNavigate(child.href, child.locked)}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        px: 1,
                        py: 0.5,
                        borderRadius: '3px',
                        cursor: child.locked ? 'not-allowed' : 'pointer',
                        opacity: child.locked ? 0.4 : 1,
                        backgroundColor: isActive ? alpha(primaryColor, 0.2) : 'transparent',
                        '&:hover': {
                          backgroundColor: child.locked ? 'transparent' : menuHover
                        },
                        transition: 'background-color 150ms'
                      }}
                    >
                      <i
                        className={child.locked ? 'ri-lock-line' : child.icon}
                        style={{ color: accentLight, fontSize: 16, opacity: child.locked ? 0.5 : 0.8 }}
                      />
                      <Typography
                        sx={{
                          color: isActive ? accentLight : 'rgba(255,255,255,0.75)',
                          fontSize: 12.5,
                          fontWeight: isActive ? 600 : 400,
                          lineHeight: 1.4
                        }}
                      >
                        {child.label}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            )
          })}
        </Box>
      </Box>
    </Popover>
  )
}

export default VCenterBurgerMenu
