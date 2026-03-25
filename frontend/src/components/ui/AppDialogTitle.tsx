'use client'

import React from 'react'
import { DialogTitle, IconButton, Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

type AppDialogTitleProps = {
  children: React.ReactNode
  onClose?: () => void
  icon?: React.ReactNode
  sx?: SxProps<Theme>
}

export default function AppDialogTitle({ children, onClose, icon, sx }: AppDialogTitleProps) {
  return (
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, ...sx as any }}>
      {icon}
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      {onClose && (
        <IconButton onClick={onClose} size="small" sx={{ ml: 1, opacity: 0.5, '&:hover': { opacity: 1 } }}>
          <i className="ri-close-line" style={{ fontSize: 18 }} />
        </IconButton>
      )}
    </DialogTitle>
  )
}
