'use client'

import React, { useState } from 'react'

import { Checkbox, IconButton, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'

// ─── Connection Filter ───────────────────────────────────────────────────────
// Shared by the chart widgets that load per-node trends. An empty selection
// means "all connections", which is also what the reset entry restores.
function ConnectionFilter({ connections, selected, onChange, t }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const allSelected = !selected || selected.length === 0

  const handleToggle = (id) => {
    if (allSelected) {
      onChange([id])
    } else if (selected.includes(id)) {
      const next = selected.filter(k => k !== id)

      onChange(next.length === 0 ? [] : next)
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <>
      <Tooltip title={t('common.filter')}>
        <IconButton size='small' onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget) }} sx={{ p: 0.25 }}>
          <i className='ri-filter-3-line' style={{ fontSize: '1rem', opacity: allSelected ? 0.65 : 1 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { maxHeight: 300 } } }}>
        <MenuItem dense onClick={() => { onChange([]); setAnchorEl(null) }}>
          <Checkbox size='small' checked={allSelected} sx={{ p: 0, mr: 1 }} />
          <ListItemText primaryTypographyProps={{ fontSize: '0.8571rem' }}>{t('common.all')}</ListItemText>
        </MenuItem>
        {connections.map(c => {
          const checked = allSelected || selected.includes(c.id)


return (
            <MenuItem key={c.id} dense onClick={() => handleToggle(c.id)}>
              <Checkbox size='small' checked={checked} sx={{ p: 0, mr: 1 }} />
              <ListItemText primaryTypographyProps={{ fontSize: '0.8571rem' }}>{c.name}</ListItemText>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

export default ConnectionFilter
