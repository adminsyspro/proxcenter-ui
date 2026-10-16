'use client'

// The firewall log of a guest or of a security group in a dialog (ui#1114):
// the inventory tab, the VM Rules and the Security Groups panels open it, from
// the guest, the group or one of their rules. The log itself is FirewallLogView.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, useTheme } from '@mui/material'

import FirewallLogView from './FirewallLogView'

import type { LogGuestInfo, LogRuleFilter } from './FirewallLogView'
import type { FirewallLogScope } from '@/lib/api/firewall'

export type { LogGuestInfo, LogRuleFilter }

interface Props {
  open: boolean
  onClose: () => void
  connectionId: string
  scope: FirewallLogScope
  /** Shown as a chip next to the title (guest or group name). */
  subject?: string
  /** Guest names and states, for the Guest column of a group's log. */
  guests?: Record<number, LogGuestInfo>
  /** Controls rendered above the filters (the guest's log levels). */
  headerExtra?: ReactNode
  /** Only the lines one rule may have written. */
  ruleFilter?: LogRuleFilter
}

/** Mounted only while open, so every opening starts from fresh state. */
export default function FirewallLogDialog({ open, onClose, subject, ...view }: Props) {
  const theme = useTheme()
  const t = useTranslations()

  if (!open) return null

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-terminal-box-line" style={{ color: theme.palette.primary.main }} />
          {t('networkPage.firewallLogs')}
          {subject && <Chip label={subject} size="small" sx={{ ml: 1 }} />}
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose} size="small"><i className="ri-close-line" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <FirewallLogView {...view} />
      </DialogContent>
    </Dialog>
  )
}
