'use client'

import React from 'react'

import { useTranslations } from 'next-intl'

import {
  Divider,
  IconButton,
  Stack,
  Tooltip as MuiTooltip,
} from '@mui/material'

function NodeActions({
  disabled,
  onReboot,
  onShutdown,
}: {
  disabled?: boolean
  onReboot: () => void
  onShutdown: () => void
}) {
  const t = useTranslations()

  return (
    <Stack direction="row" spacing={0.25} alignItems="center">
      {/* Reboot */}
      <MuiTooltip title={t('inventory.nodeReboot')}>
        <span>
          <IconButton
            size="small"
            onClick={onReboot}
            disabled={disabled}
            sx={{ color: '#f59e0b', '&:hover': { bgcolor: 'rgba(245,158,11,0.12)' } }}
          >
            <i className="ri-restart-line" style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Shutdown */}
      <MuiTooltip title={t('inventory.nodeShutdown')}>
        <span>
          <IconButton
            size="small"
            onClick={onShutdown}
            disabled={disabled}
            sx={{ color: '#c62828', '&:hover': { bgcolor: 'rgba(198,40,40,0.12)' } }}
          >
            <i className="ri-shut-down-line" style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </MuiTooltip>
    </Stack>
  )
}

export default NodeActions
