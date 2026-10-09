'use client'

import { Box, DialogTitle, IconButton, Typography } from '@mui/material'

/**
 * Header shared by the per-connection dialogs of the connection grid
 * (diagnostics, connection check): icon, title, connection name, close.
 */
export default function ConnectionDialogTitle({
  icon,
  title,
  connectionName,
  onClose,
}: {
  icon: string
  title: string
  connectionName?: string | null
  onClose: () => void
}) {
  return (
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, pb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={icon} style={{ fontSize: 20 }} />
        <Box>
          <Typography variant='subtitle1' sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {title}
          </Typography>
          {connectionName && (
            <Typography variant='caption' sx={{ opacity: 0.6 }}>
              {connectionName}
            </Typography>
          )}
        </Box>
      </Box>
      <IconButton size='small' onClick={onClose} sx={{ opacity: 0.6 }}>
        <i className='ri-close-line' style={{ fontSize: 18 }} />
      </IconButton>
    </DialogTitle>
  )
}
