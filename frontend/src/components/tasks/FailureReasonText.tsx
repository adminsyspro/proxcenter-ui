'use client'

import { Tooltip, Typography } from '@mui/material'

/**
 * Why a task or a migration failed (#926), on the row itself: one line in the
 * error colour, truncated, with the whole text in the tooltip.
 */
export default function FailureReasonText({ reason, sx }: Readonly<{ reason?: string | null; sx?: Record<string, unknown> }>) {
  if (!reason) return null

  return (
    <Tooltip title={reason}>
      <Typography
        variant="caption"
        noWrap
        sx={{ display: 'block', minWidth: 0, color: 'error.main', overflow: 'hidden', textOverflow: 'ellipsis', ...sx }}
      >
        {reason}
      </Typography>
    </Tooltip>
  )
}
