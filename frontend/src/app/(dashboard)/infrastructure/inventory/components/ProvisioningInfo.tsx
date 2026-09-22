import React from 'react'

import { Box, Chip, Tooltip, Typography } from '@mui/material'

import type { ProvisioningLabels } from '../nodeProvisioning'

/**
 * The provisioned figures of #969, shown without costing the summary a line:
 * the overcommit ratio rides beside the gauge label, the breakdown waits in the
 * marker's tooltip.
 */

export function ProvisioningChip({ labels }: { labels: ProvisioningLabels }) {
  if (!labels.chip) return null

  return (
    // The chip is what the eye lands on, so it carries the same breakdown as
    // the marker rather than leaving a hover that answers nothing.
    <Tooltip title={<ProvisioningTooltip labels={labels} />} arrow placement="top">
      <Chip
        size="small"
        data-testid="provisioning-chip"
        data-overcommitted={labels.overcommitted ? 'true' : 'false'}
        // A bare "0.38x" beside "CPU usage" reads as a usage figure; the icon
        // says it counts what is handed out, the way SensorTemp's does next to it.
        icon={<i className="ri-stack-line" style={{ fontSize: 11 }} />}
        label={labels.chip}
        aria-label={labels.chipLabel}
        variant="outlined"
        // Colour only once the node promises more than it owns; below that the
        // ratio is ordinary information and should not shout.
        color={labels.overcommitted ? 'warning' : 'default'}
        sx={{
          height: 18,
          fontSize: '0.7rem',
          fontWeight: 600,
          cursor: 'help',
          '& .MuiChip-label': { px: 0.5 },
          '& .MuiChip-icon': { ml: 0.5, mr: 0, color: 'inherit' },
        }}
      />
    </Tooltip>
  )
}

export function ProvisioningTooltip({ labels }: { labels: ProvisioningLabels }) {
  const { title, rows, capacity } = labels.tooltip

  return (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto auto', columnGap: 1.5, rowGap: 0.25 }}>
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>{row.label}</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right' }}>{row.value}</Typography>
            <Typography variant="caption" sx={{ textAlign: 'right' }}>{row.ratio ?? ''}</Typography>
          </React.Fragment>
        ))}
      </Box>
      {capacity ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.7 }}>
          {capacity}
        </Typography>
      ) : null}
    </Box>
  )
}
