'use client'

/**
 * Disk profile of the migration dialogs (ui#1331): the options every target
 * disk starts from. Discard is applied on thin-provisioned storage only, IO
 * thread on the buses that support it, SSD emulation where the bus has it;
 * the review step can still change one disk.
 */

import React from 'react'
import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import type { DiskProfileState } from './migrationReview'

const OPTIONS = [
  { key: 'discard', label: 'reviewDiskOptDiscard' },
  { key: 'iothread', label: 'reviewDiskOptIothread' },
  { key: 'ssd', label: 'reviewDiskOptSsd' },
] as const

export default function DiskProfileField({ value, onChange }: { value: DiskProfileState; onChange: (next: DiskProfileState) => void }) {
  const t = useTranslations()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-testid="disk-profile">
      <Box component="i" className="ri-hard-drive-3-line" sx={{ fontSize: 16, opacity: 0.7 }} />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{t('inventoryPage.esxiMigration.diskProfile')}</Typography>
      {OPTIONS.map(opt => (
        <Chip
          key={opt.key}
          size="small"
          label={t(`inventoryPage.esxiMigration.${opt.label}`)}
          color={value[opt.key] ? 'primary' : 'default'}
          variant={value[opt.key] ? 'filled' : 'outlined'}
          onClick={() => onChange({ ...value, [opt.key]: !value[opt.key] })}
          aria-pressed={value[opt.key]}
          data-testid={`disk-profile-${opt.key}`}
          sx={{ height: 22, fontSize: 11 }}
        />
      ))}
      <Tooltip title={t('inventoryPage.esxiMigration.diskProfileHelp')} arrow placement="top">
        <Box component="i" className="ri-information-line" sx={{ fontSize: 16, opacity: 0.6, cursor: 'help' }} data-testid="disk-profile-help" />
      </Tooltip>
    </Box>
  )
}
