'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material'

import { LXC_FEATURES, parseLxcFeatures } from '../helpers'
import type { DetailsPayload } from '../types'

export type LxcOptionEdit = { key: 'features'; label: string; value: string; type: 'features'; unprivileged: boolean }

type Props = {
  optionsInfo: DetailsPayload['optionsInfo'] | undefined
  /** Pending-restart marker of the Options table, keyed by PVE config key. */
  pendingChip: (key: string) => React.ReactNode
  onEdit: (dialog: LxcOptionEdit) => void
}

const cellBorder = '1px solid var(--mui-palette-divider)'
const labelCell: React.CSSProperties = { padding: '3px 12px', borderBottom: cellBorder, fontSize: 12, fontWeight: 500 }
const valueCell: React.CSSProperties = { padding: '3px 12px', borderBottom: cellBorder, fontSize: 12, position: 'relative' }
const actionCell: React.CSSProperties = { padding: '3px 12px', borderBottom: cellBorder, fontSize: 12, textAlign: 'center' }

/**
 * Container-only rows of the Options tab (#566): the privilege level PVE
 * fixes at creation, and the `features` property string (nesting, keyctl,
 * FUSE, device nodes, NFS/CIFS mounts) that can be edited after creation.
 */
export default function LxcOptionRows({ optionsInfo, pendingChip, onEdit }: Props) {
  const t = useTranslations()
  const enabled = parseLxcFeatures(optionsInfo?.features).enabled
  const features = LXC_FEATURES.filter(feature => enabled.includes(feature.key))

  return (
    <>
      <tr>
        <td style={labelCell}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-shield-user-line" style={{ fontSize: 16, opacity: 0.6 }} />
            {t('inventory.createLxc.unprivilegedContainer')}
          </Box>
        </td>
        <td style={valueCell}>
          <Chip
            size="small"
            label={optionsInfo?.unprivileged ? t('common.yes') : t('common.no')}
            color={optionsInfo?.unprivileged ? 'success' : 'warning'}
            variant="outlined"
          />
        </td>
        <td style={actionCell}>
          <Tooltip title={t('inventory.notEditable')}>
            <span>
              <IconButton size="small" disabled>
                <i className="ri-lock-line" style={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </td>
      </tr>
      <tr>
        <td style={labelCell}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-toggle-line" style={{ fontSize: 16, opacity: 0.6 }} />
            {t('inventory.features')}
          </Box>
        </td>
        <td style={valueCell}>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {features.length > 0 ? (
              features.map(feature => (
                <Chip key={feature.key} size="small" variant="outlined" label={t(feature.labelKey)} sx={{ height: 22 }} />
              ))
            ) : (
              <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('common.none')}</Typography>
            )}
          </Box>
          {pendingChip('features')}
        </td>
        <td style={actionCell}>
          <Tooltip title={t('common.edit')}>
            <IconButton
              size="small"
              aria-label={t('common.edit')}
              onClick={() => onEdit({ key: 'features', label: t('inventory.features'), value: optionsInfo?.features || '', type: 'features', unprivileged: Boolean(optionsInfo?.unprivileged) })}
            >
              <i className="ri-pencil-line" style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </td>
      </tr>
    </>
  )
}
