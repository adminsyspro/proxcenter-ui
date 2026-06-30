'use client'

import { useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Box, Popover, Typography, Chip } from '@mui/material'
import { useTheme, alpha } from '@mui/material/styles'

import { menuData } from '@/@menu/menuData'
import { useRBAC } from '@/contexts/RBACContext'
import { hasInfraScope } from '@/lib/rbac/scopeKinds'
import { useLicense } from '@/contexts/LicenseContext'
import { useMyVdcs } from '@/hooks/useMyVdcs'
import { useTenant } from '@/contexts/TenantContext'

// Section accent colors for visual distinction
const sectionColors = {
  0: '#2196f3', // Dashboard - blue
  1: '#7c3aed', // Infrastructure - purple
  2: '#f59e0b', // Orchestration - amber
  3: '#10b981', // Operations - emerald
  4: '#ef4444', // Security - red
  5: '#6b7280', // Settings - gray
}

const BurgerMenu = ({ anchorEl, open, onClose }) => {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations()
  const theme = useTheme()
  const { hasPermission, scopeTypes, isAdmin, loading: rbacLoading } = useRBAC()
  const { hasFeature } = useLicense()
  const { hasVdc, loading: vdcLoading } = useMyVdcs()
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProviderTenant = currentTenant?.id === 'default'
  const infraScoped = hasInfraScope(scopeTypes, isAdmin)

  const sections = useMemo(() => {
    const data = menuData(t)
    const result = []

    // Mirrors the canView logic in GenerateMenu.jsx so the burger and the
    // horizontal nav agree on visibility. Without this, items declaring
    // requires.hasVdc were always shown in the burger (e.g. "My vDC"
    // appeared on the default tenant even when no vDC existed).
    const passesRequires = (entry) => {
      if (rbacLoading || vdcLoading || tenantLoading) return true
      if (entry.requires?.hasVdc === true && !hasVdc) return false
      if (entry.requires?.hasVdc === false && hasVdc) return false
      if (entry.requires?.isProviderTenant === true && !isProviderTenant) return false
      if (entry.requires?.infraScope === true && !infraScoped) return false
      return true
    }

    for (const item of data) {
      if (!passesRequires(item)) continue

      if (!item.isSection) {
        if (item.permissions && !item.permissions.some(p => hasPermission(p))) continue
        result.push({
          standalone: true,
          label: item.label,
          icon: item.icon,
          href: item.href,
          locked: item.requiredFeature && !hasFeature(item.requiredFeature),
        })
        continue
      }

      if (item.permissions && !item.permissions.some(p => hasPermission(p))) continue

      const sectionLocked = item.requiredFeature && !hasFeature(item.requiredFeature)

      const children = (item.children || []).filter(child => {
        if (!passesRequires(child)) return false
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
          icon: item.icon,
          children
        })
      }
    }

    return result
  }, [t, hasPermission, hasFeature, hasVdc, isProviderTenant, infraScoped, rbacLoading, vdcLoading, tenantLoading])

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
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
            mt: 1,
            width: { xs: '95vw', sm: 560, md: 720 },
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 20px 60px -12px rgba(0,0,0,0.25)',
          }
        }
      }}
    >
      <Box sx={{ p: 2.5 }}>
        {/* Grid of sections */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 1,
          }}
        >
          {sections.map((section, idx) => {
            const accent = sectionColors[idx] || theme.palette.primary.main

            if (section.standalone) {
              const isActive = pathname === section.href
              return (
                <Box
                  key={idx}
                  onClick={() => handleNavigate(section.href, section.locked)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1.25,
                    borderRadius: 2,
                    cursor: 'pointer',
                    bgcolor: isActive ? alpha(accent, 0.1) : 'transparent',
                    border: '1px solid',
                    borderColor: isActive ? alpha(accent, 0.2) : 'transparent',
                    transition: 'all 0.15s ease',
                    '&:hover': {
                      bgcolor: alpha(accent, 0.08),
                      borderColor: alpha(accent, 0.15),
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(accent, 0.1),
                      flexShrink: 0,
                    }}
                  >
                    <i className={section.icon} style={{ fontSize: 17, color: accent }} />
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: isActive ? accent : 'text.primary' }}>
                    {section.label}
                  </Typography>
                </Box>
              )
            }

            return (
              <Box
                key={idx}
                sx={{
                  borderRadius: 2.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s',
                  '&:hover': { borderColor: alpha(accent, 0.3) },
                }}
              >
                {/* Section header */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 1,
                    bgcolor: alpha(accent, 0.04),
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Box
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(accent, 0.12),
                      flexShrink: 0,
                    }}
                  >
                    <i className={section.icon} style={{ fontSize: 14, color: accent }} />
                  </Box>
                  <Typography
                    sx={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: accent,
                      flex: 1,
                    }}
                  >
                    {section.label}
                  </Typography>
                  <Typography variant='caption' sx={{ fontSize: 10, opacity: 0.4 }}>
                    {section.children.length}
                  </Typography>
                </Box>

                {/* Section items */}
                <Box sx={{ py: 0.5 }}>
                  {section.children.map((child, cidx) => {
                    const isActive = pathname?.startsWith(child.href)
                    return (
                      <Box
                        key={cidx}
                        onClick={() => handleNavigate(child.href, child.locked)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.25,
                          px: 1.5,
                          py: 0.75,
                          mx: 0.5,
                          borderRadius: 1.5,
                          cursor: child.locked ? 'not-allowed' : 'pointer',
                          opacity: child.locked ? 0.4 : 1,
                          bgcolor: isActive ? alpha(accent, 0.08) : 'transparent',
                          transition: 'all 0.12s ease',
                          '&:hover': {
                            bgcolor: child.locked ? 'transparent' : alpha(accent, 0.06),
                          },
                        }}
                      >
                        <i
                          className={child.locked ? 'ri-lock-line' : child.icon}
                          style={{
                            fontSize: 15,
                            color: isActive ? accent : 'inherit',
                            opacity: child.locked ? 0.5 : isActive ? 1 : 0.55,
                          }}
                        />
                        <Typography
                          sx={{
                            fontSize: 12.5,
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? accent : 'text.primary',
                            lineHeight: 1.3,
                            flex: 1,
                          }}
                        >
                          {child.label}
                        </Typography>
                        {child.locked && (
                          <Chip
                            label='Pro'
                            size='small'
                            sx={{
                              height: 16,
                              fontSize: 9,
                              fontWeight: 700,
                              bgcolor: alpha(theme.palette.warning.main, 0.12),
                              color: theme.palette.warning.main,
                              '& .MuiChip-label': { px: 0.75 },
                            }}
                          />
                        )}
                      </Box>
                    )
                  })}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Popover>
  )
}

export default BurgerMenu
