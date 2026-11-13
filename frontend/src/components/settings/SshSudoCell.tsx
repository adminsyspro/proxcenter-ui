'use client'

import { useTranslations } from 'next-intl'
import { Box, Chip, Tooltip, Typography } from '@mui/material'

// How a PVE connection runs its privileged commands, read from its settings
// only: probing the nodes for every row would open one SSH session per node
// each time the list is shown. The Test button of the connection checks the
// sudo profiles on each node.
export type SudoMode = 'none' | 'root' | 'sudo' | 'plain'

export interface SshSudoConnection {
  sshEnabled?: boolean | null
  sshUser?: string | null
  sshUseSudo?: boolean | null
}

export function sudoMode(conn: SshSudoConnection | null | undefined): SudoMode {
  if (!conn?.sshEnabled) return 'none'
  if ((conn.sshUser || 'root') === 'root') return 'root'

  return conn.sshUseSudo ? 'sudo' : 'plain'
}

const LOOK: Record<Exclude<SudoMode, 'none'>, { color: 'default' | 'success' | 'warning'; icon: string }> = {
  root: { color: 'default', icon: 'ri-user-star-line' },
  sudo: { color: 'success', icon: 'ri-shield-check-line' },
  plain: { color: 'warning', icon: 'ri-error-warning-line' },
}

export default function SshSudoCell({ connection }: { connection: SshSudoConnection }) {
  const t = useTranslations()
  const mode = sudoMode(connection)

  if (mode === 'none') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <Typography variant='caption' sx={{ opacity: 0.4 }}>-</Typography>
      </Box>
    )
  }

  const { color, icon } = LOOK[mode]

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
      <Tooltip title={t(`settings.sudoColumn.${mode}Tooltip`, { user: connection.sshUser || 'root' })}>
        <Chip
          size='small'
          variant='outlined'
          color={color}
          label={t(`settings.sudoColumn.${mode}`)}
          icon={<i className={icon} style={{ fontSize: 14 }} />}
        />
      </Tooltip>
    </Box>
  )
}
