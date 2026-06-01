'use client'

import React, { useState } from 'react'
import { Box, IconButton, InputBase, Typography, useTheme } from '@mui/material'

function SectionHeaderWidget({ config, data, loading, onUpdateSettings }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const title = config?.settings?.title || 'Section'
  const collapsed = config?.settings?.collapsed || false

  const handleToggle = () => {
    if (onUpdateSettings) onUpdateSettings({ collapsed: !collapsed })
  }

  const handleStartEdit = (e) => {
    e.stopPropagation()
    setEditValue(title)
    setEditing(true)
  }

  const handleSave = () => {
    setEditing(false)
    if (editValue.trim() && editValue !== title) {
      if (onUpdateSettings) onUpdateSettings({ title: editValue.trim() })
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <Box
      onClick={handleToggle}
      sx={{
        height: '100%',
        display: 'flex', alignItems: 'center', gap: 0.75,
        px: 0.5,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Collapse icon */}
      <i
        className={collapsed ? 'ri-arrow-right-s-line' : 'ri-arrow-down-s-line'}
        style={{ fontSize: '1.1429rem', opacity: 0.5, flexShrink: 0 }}
      />

      {/* Title */}
      {editing ? (
        <InputBase
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          sx={{
            fontSize: '0.7857rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            '& input': { p: 0 },
          }}
        />
      ) : (
        <Typography
          onDoubleClick={handleStartEdit}
          sx={{
            fontSize: '0.7857rem', fontWeight: 700, opacity: 0.6,
            textTransform: 'uppercase', letterSpacing: 0.5,
            flexShrink: 0,
          }}
        >
          {title}
        </Typography>
      )}

      {/* Divider line */}
      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />

      {/* Edit button */}
      <IconButton
        size='small'
        onClick={(e) => { e.stopPropagation(); handleStartEdit(e) }}
        sx={{ p: 0.25, opacity: 0.3, '&:hover': { opacity: 0.8 } }}
      >
        <i className='ri-pencil-line' style={{ fontSize: '0.8571rem' }} />
      </IconButton>
    </Box>
  )
}

export default React.memo(SectionHeaderWidget)
