'use client'

import { useState } from 'react'

import { Box, Button, ListItemIcon, Menu, MenuItem, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useTenant } from '@/contexts/TenantContext'
import { useMyVdcs } from '@/hooks/useMyVdcs'
import { readVdcContextCookie, setVdcContextCookie } from '@/lib/vdc/contextCookie'

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

/**
 * Header switcher for the vDC view context (Cloud Director style). Rendered
 * only for IaaS tenants with ≥2 visible active vDCs — /api/v1/vdcs is
 * tenant-scoped and RBAC-filtered server-side. Selecting writes the
 * pc_vdc_context cookie and reloads: the server narrows every page/API to
 * that vDC. "All vDCs" clears the cookie (union view, the default).
 */
export default function VdcSwitcher() {
  const { isProvider, isMsp, loading: tenantLoading } = useTenant()
  const { vdcs, loading: vdcsLoading } = useMyVdcs()
  const t = useTranslations()

  const [anchorEl, setAnchorEl] = useState(null)

  const activeVdcs = vdcs.filter(v => v.enabled !== false)

  if (tenantLoading || vdcsLoading || isProvider || isMsp || activeVdcs.length < 2) {
    return null
  }

  const contextId = readVdcContextCookie()
  const current = activeVdcs.find(v => v.id === contextId) || null

  const handleSelect = (vdcId) => {
    setAnchorEl(null)
    if ((vdcId || null) === (current?.id || null)) return
    setVdcContextCookie(vdcId)
    window.location.reload()
  }

  return (
    <>
      <Tooltip title={t('navbar.switchVdc')} slotProps={tooltipSlotProps}>
        <Button
          size='small'
          onClick={(e) => setAnchorEl(e.currentTarget)}
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
          <i className='ri-cloud-line' style={{ fontSize: 15, flexShrink: 0 }} />
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
            {current?.name ?? t('myVdc.allVdcs')}
          </Box>
          <i className='ri-arrow-down-s-line' style={{ fontSize: 15, flexShrink: 0 }} />
        </Button>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { mt: 0.5, minWidth: 200, maxWidth: 280 } } }}
      >
        <MenuItem
          selected={!current}
          onClick={() => handleSelect(null)}
          sx={{ gap: 0.5, fontSize: '0.875rem' }}
        >
          <ListItemIcon sx={{ minWidth: 28, color: !current ? 'primary.main' : 'inherit' }}>
            <i className={!current ? 'ri-checkbox-circle-fill' : 'ri-stack-line'} style={{ fontSize: 16 }} />
          </ListItemIcon>
          {t('myVdc.allVdcs')}
        </MenuItem>
        {activeVdcs.map((vdc) => {
          const isActive = vdc.id === current?.id

          return (
            <MenuItem
              key={vdc.id}
              selected={isActive}
              onClick={() => handleSelect(vdc.id)}
              sx={{ gap: 0.5, fontSize: '0.875rem' }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: isActive ? 'primary.main' : 'inherit' }}>
                <i className={isActive ? 'ri-checkbox-circle-fill' : 'ri-cloud-line'} style={{ fontSize: 16 }} />
              </ListItemIcon>
              <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {vdc.name}
              </Box>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
