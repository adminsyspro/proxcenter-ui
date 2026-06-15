'use client'

import { useState, useMemo } from 'react'

import {
  Box,
  Button,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { useTenant } from '@/contexts/TenantContext'

const tooltipSlotProps = {
  tooltip: {
    sx: {
      bgcolor: 'background.paper',
      color: 'text.primary',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1.5,
      boxShadow: 3,
    }
  }
}

export default function TenantSwitcher() {
  const { currentTenant, availableTenants, switchTenant, isMultiTenant, loading } = useTenant()
  const t = useTranslations('navbar')

  const [anchorEl, setAnchorEl] = useState(null)
  const [search, setSearch] = useState('')

  // All hooks must run before any early return (Rules of Hooks): loading flips
  // from true to false on first tenant fetch, so a conditionally-called useMemo
  // would change the hook count between renders and crash the navbar.
  const showSearch = availableTenants.length > 8

  const filteredTenants = useMemo(() => {
    if (!showSearch || !search.trim()) return availableTenants
    const q = search.trim().toLowerCase()
    // Keep provider/default always at top
    const provider = availableTenants.filter(tn => tn.id === 'default')
    const rest = availableTenants.filter(tn => tn.id !== 'default' && tn.name.toLowerCase().includes(q))
    return [...provider, ...rest]
  }, [availableTenants, search, showSearch])

  if (loading || !isMultiTenant || availableTenants.length <= 1) {
    return null
  }

  const isDefault = currentTenant?.id === 'default'
  const leadingIcon = isDefault ? 'ri-stack-line' : 'ri-building-line'

  const handleOpen = (e) => {
    setAnchorEl(e.currentTarget)
    setSearch('')
  }

  const handleClose = () => {
    setAnchorEl(null)
    setSearch('')
  }

  const handleSelect = (tenantId) => {
    if (tenantId !== currentTenant?.id) {
      switchTenant(tenantId)
    }
    handleClose()
  }

  return (
    <>
      <Tooltip title={t('switchTenant')} slotProps={tooltipSlotProps}>
        <Button
          size='small'
          onClick={handleOpen}
          sx={{
            height: 32,
            px: 1.25,
            gap: 0.75,
            color: 'text.primary',
            borderRadius: 1,
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.8125rem',
            bgcolor: 'transparent',
            border: '1px solid',
            borderColor: 'divider',
            '&:hover': {
              bgcolor: 'action.hover',
              borderColor: 'text.secondary',
            },
          }}
        >
          <i className={leadingIcon} style={{ fontSize: 15, flexShrink: 0 }} />
          <Box
            component='span'
            sx={{
              maxWidth: 140,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'block',
            }}
          >
            {currentTenant?.name ?? ''}
          </Box>
          <i className='ri-arrow-down-s-line' style={{ fontSize: 15, flexShrink: 0 }} />
        </Button>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              minWidth: 200,
              maxWidth: 280,
            }
          }
        }}
      >
        {showSearch && (
          <Box sx={{ px: 1.5, pt: 1, pb: 0.5 }}>
            <TextField
              size='small'
              autoFocus
              fullWidth
              placeholder={t('searchTenants')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <i className='ri-search-line' style={{ fontSize: 14 }} />
                    </InputAdornment>
                  ),
                }
              }}
              sx={{ '& .MuiInputBase-input': { fontSize: '0.8125rem' } }}
            />
          </Box>
        )}

        {filteredTenants.map((tenant) => {
          const isActive = tenant.id === currentTenant?.id
          const icon = isActive
            ? 'ri-checkbox-circle-fill'
            : tenant.id === 'default'
              ? 'ri-stack-line'
              : 'ri-building-line'

          return (
            <MenuItem
              key={tenant.id}
              selected={isActive}
              onClick={() => handleSelect(tenant.id)}
              sx={{ gap: 0.5, fontSize: '0.875rem' }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: isActive ? 'primary.main' : 'inherit' }}>
                <i className={icon} style={{ fontSize: 16 }} />
              </ListItemIcon>
              <Box
                component='span'
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tenant.name}
              </Box>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
